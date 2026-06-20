// src/client/components/CharSelectOverlay.tsx
// 选将遮罩:开局每位玩家轮流从候选武将中选 1 位(主公先选,之后逆时针)。
// - 自身选将:展示候选卡 + 可点选 + 确认按钮;
// - 他人选将:仅显示「等待 P<n> 选将」;
// - 主公选将且非自身:显示「主公正在选将,请等待」(主公身份已公开)。
//
// 选将保密:非自身选将时,不暴露 seat 玩家名字(避免情报泄漏)。
// 选将逻辑:玩家点选后,内部维护 selectedCharIdx,点「确认」才向引擎发 respond action。

import { useState, useEffect } from 'react';
import { FACTION_BG, IDENTITY_COLORS } from './gameViewConstants';
import { CountdownBar } from './CountdownBar';

export interface CharSelectOverlayCandidate {
  name: string;
  skills: string[];
}

export interface CharacterMeta {
  faction: string;
  maxHealth: number;
}

interface CharSelectOverlayProps {
  /** 引擎生成的候选武将(已排除已选武将) */
  candidates: CharSelectOverlayCandidate[];
  /** 当前选将的座次下标 */
  charSelectTarget: number;
  /** 是否自己正在选将 */
  isSelfSelecting: boolean;
  /** 当前选将的玩家是否主公 */
  isLord: boolean;
  /** 当前视角下标(viewer) */
  viewer: number;
  /** viewer 的身份(用于身份牌配色);可空表示尚未分配 */
  viewerIdentity?: string;
  /** 选将截止时间戳(由引擎 pending.deadline 传入);为 null 不显示倒计时 */
  deadline: number | null;
  /** 选将总时长(由引擎 pending.totalMs 传入,默认 30s) */
  totalMs: number;
  /** 点确认后回调,通知父组件发送选将 respond action */
  onSelect: (characterName: string) => void;
  /** 从 engine character-meta 获取武将的势力/体力上限;
   *  通过 prop 注入而非直接 import,便于解耦与单元测试。
   *  找不到时回退 faction='群'、maxHealth=4。 */
  getCharacterMeta: (name: string) => CharacterMeta | undefined;
  /** ── debug 模式视角切换(可选) ── */
  /** 当前视角下标(可能与 viewer 不同,debug 模式可切换) */
  perspectiveIdx?: number;
  /** 总玩家数 */
  playerCount?: number;
  /** 切换到下一个视角 */
  onSwitchPerspective?: () => void;
  /** 跳到当前回合玩家视角 */
  onGoToCurrentPlayer?: () => void;
  /** 当前回合玩家名(显示在按钮上) */
  currentPlayerName?: string;
  /** 视角玩家名 */
  perspectiveName?: string;
  /** 主公已选的武将名(主公选完后,其他玩家查看时展示) */
  lordCharacter?: string;
}

/**
 * 选将遮罩。
 * - 自维护 `selectedCharIdx`(候选高亮态),pending/target 变化时重置;
 * - 势力色 / 体力上限通过 `getCharacterMeta` prop 注入,不依赖硬编码 CHAR_POOL。
 */
export function CharSelectOverlay({
  candidates,
  charSelectTarget,
  isSelfSelecting,
  isLord,
  viewer,
  viewerIdentity,
  deadline,
  totalMs,
  onSelect,
  getCharacterMeta,
  perspectiveIdx,
  playerCount,
  onSwitchPerspective,
  onGoToCurrentPlayer,
  currentPlayerName,
  perspectiveName,
  lordCharacter,
}: CharSelectOverlayProps) {
  const [selectedCharIdx, setSelectedCharIdx] = useState<number | null>(null);
  // pending/target 变化时清空选中态
  useEffect(() => { setSelectedCharIdx(null); }, [isSelfSelecting, charSelectTarget]);

  const viewerColor = viewerIdentity ? (IDENTITY_COLORS[viewerIdentity] || '#888') : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.9)',
      }}
    >
      {/* ── debug 视角切换栏 ── */}
      {onSwitchPerspective && playerCount !== undefined && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 16,
            display: 'flex',
            gap: 8,
            zIndex: 10000,
          }}
        >
          <button
            onClick={onSwitchPerspective}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 'bold',
              color: '#fff',
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            视角: {perspectiveName ?? `P${perspectiveIdx}`}
          </button>
          {onGoToCurrentPlayer && currentPlayerName && (
            <button
              onClick={onGoToCurrentPlayer}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                color: '#fff',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              查看当前玩家
            </button>
          )}
        </div>
      )}
      {/* 标题:主公选将 / P<n> 选将中 */}
      <div
        style={{
          fontSize: 24,
          fontWeight: 'bold',
          color: '#ffd700',
          marginBottom: 8,
          letterSpacing: 4,
        }}
      >
        {isLord ? '主公选将' : `P${charSelectTarget} 选将中`}
      </div>
      {isLord && <div style={{ fontSize: 14, color: '#aaa', marginBottom: 8 }}>主公已亮明身份</div>}
      {isSelfSelecting && !isLord && <div style={{ fontSize: 14, color: '#aaa', marginBottom: 8 }}>你正在选将(他人不可见你的选择)</div>}
      {!isLord && !isSelfSelecting && <div style={{ fontSize: 14, color: '#aaa', marginBottom: 8 }}>选将保密</div>}

      {/* 主公已选武将(主公身份公开,选将结果所有人可见) */}
      {!isLord && lordCharacter && (
        <div style={{ fontSize: 15, color: '#ffd700', marginBottom: 8, fontWeight: 'bold' }}>
          主公已选择: {lordCharacter}
        </div>
      )}

      {/* 倒计时进度条 */}
      <div style={{ width: 300, marginBottom: 24 }}>
        <CountdownBar deadline={deadline} totalMs={totalMs} />
      </div>

      {/* 自身信息区:身份牌 + 座次 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {viewerColor && viewerIdentity && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '8px 18px',
              borderRadius: 8,
              background: viewerColor,
              color: '#fff',
              boxShadow: '0 2px 12px rgba(0, 0, 0, 0.4)',
              minWidth: 90,
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.85, letterSpacing: 2 }}>你的身份</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', textShadow: '0 1px 4px rgba(0, 0, 0, 0.3)' }}>{viewerIdentity}</div>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            padding: '8px 18px',
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#fff',
            minWidth: 90,
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 2 }}>你的座次</div>
          <div style={{ fontSize: 20, fontWeight: 'bold' }}>P{viewer + 1}</div>
        </div>
      </div>

      {isSelfSelecting ? (
        <>
          {/* 候选网格(最多 5 列) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(candidates.length, 5)}, 1fr)`,
              gap: 16,
              maxWidth: 800,
              width: '90%',
            }}
          >
            {candidates.map((ch, i) => {
              const isSelected = selectedCharIdx === i;
              const meta = getCharacterMeta(ch.name);
              const faction = meta?.faction ?? '群';
              const maxHealth = meta?.maxHealth ?? 4;
              return (
                <div
                  key={ch.name}
                  onClick={() => setSelectedCharIdx(i)}
                  style={{
                    background: FACTION_BG[faction] || '#333',
                    borderRadius: 12,
                    padding: '24px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    border: isSelected ? '3px solid #ffd700' : '3px solid transparent',
                    boxShadow: isSelected
                      ? '0 0 20px rgba(255, 215, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.3)'
                      : '0 4px 16px rgba(0, 0, 0, 0.3)',
                    transform: isSelected ? 'translateY(-8px) scale(1.03)' : 'translateY(0)',
                    transition: 'all 0.25s cubic-bezier(0.23, 1, 0.32, 1)',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = 'translateY(-6px)';
                      e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.4)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
                    }
                  }}
                >
                  <div style={{ fontSize: 22, fontWeight: 'bold', color: '#fff', textShadow: '0 1px 4px rgba(0, 0, 0, 0.3)' }}>{ch.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.7)', background: 'rgba(0, 0, 0, 0.2)', borderRadius: 6, padding: '2px 8px' }}>
                    {faction} · {ch.skills.join(' / ')}
                  </div>
                  <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                    {Array.from({ length: maxHealth }, (_, j) => (
                      <div
                        key={j}
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: '#e74c3c',
                          boxShadow: '0 0 4px rgba(231, 76, 60, 0.5)',
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 确认按钮 */}
          <button
            disabled={selectedCharIdx === null}
            onClick={() => {
              if (selectedCharIdx !== null && candidates[selectedCharIdx]) {
                onSelect(candidates[selectedCharIdx].name);
                setSelectedCharIdx(null);
              }
            }}
            style={{
              marginTop: 32,
              padding: '12px 56px',
              fontSize: 18,
              fontWeight: 'bold',
              color: selectedCharIdx !== null ? '#000' : '#666',
              background: selectedCharIdx !== null ? 'linear-gradient(135deg, #ffd700, #f0c000)' : '#333',
              border: 'none',
              borderRadius: 8,
              cursor: selectedCharIdx !== null ? 'pointer' : 'not-allowed',
              boxShadow: selectedCharIdx !== null ? '0 4px 16px rgba(255, 215, 0, 0.3)' : 'none',
              transition: 'all 0.2s',
              letterSpacing: 2,
            }}
          >
            确认选择
          </button>
        </>
      ) : isLord ? (
        <div style={{ fontSize: 18, color: '#aaa', marginTop: 32 }}>
          主公正在选将，请等待...
        </div>
      ) : (
        <div style={{ fontSize: 18, color: '#aaa', marginTop: 32 }}>
          等待 P{charSelectTarget} 选将...
        </div>
      )}
    </div>
  );
}