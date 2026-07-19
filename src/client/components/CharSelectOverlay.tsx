// src/client/components/CharSelectOverlay.tsx
// 选将遮罩:开局每位玩家轮流从候选武将中选 1 位(主公先选,之后逆时针)。
// - 自身选将:展示候选卡 + 可点选 + 确认按钮;
// - 他人选将:仅显示「等待 P<n> 选将」;
// - 主公选将且非自身:显示「主公正在选将,请等待」(主公身份已公开)。
//
// 选将保密:非自身选将时,不暴露 seat 玩家名字(避免情报泄漏)。
// 选将逻辑:玩家点选后,内部维护 selectedCharIdx,点「确认」才向引擎发 respond action。

import { useState, useEffect, type ReactNode } from 'react';
import { css, cx } from '@linaria/core';
import { FACTION_BG, IDENTITY_COLORS } from './gameViewConstants';
import { CountdownBar } from './CountdownBar';
import { getSkillDescription } from '../../engine/skill';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import { SkillTag } from './SkillTooltip';
import { getCharacterImage } from '../assets/imageAssets';

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
  /** 主公已选的武将名(主公选完后,其他玩家查看时展示) */
  lordCharacter?: string;
  /** 右上角插槽:上层渲染视角控制等 debug UI。 */
  overlaySlot?: ReactNode;
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
  lordCharacter,
  overlaySlot,
}: CharSelectOverlayProps) {
  useSkillDescReady(); // 技能模块加载后重渲染,确保候选武将技能描述 title 命中
  const [selectedCharIdx, setSelectedCharIdx] = useState<number | null>(null);
  // 已提交锁定态:点「确认选择」后记录选中的武将名,锁定候选区与按钮,
  // 直到引擎广播新 view(选将 slot resolve → pending 切换 → 本组件卸载或重置)。
  // 此前遮罩仍在渲染,必须禁止重复点击其他武将 + 再次提交。
  const [submittedChar, setSubmittedChar] = useState<string | null>(null);
  // pending/target 变化时清空选中态与锁定态(新选将窗口开启)
  useEffect(() => {
    setSelectedCharIdx(null);
    setSubmittedChar(null);
  }, [isSelfSelecting, charSelectTarget]);

  const viewerColor = viewerIdentity ? IDENTITY_COLORS[viewerIdentity] || '#888' : null;

  return (
    <div className={overlayRoot}>
      {/* ── 右上角插槽(debug 视角控制等,由上层注入) ── */}
      {overlaySlot && <div className={overlaySlotWrap}>{overlaySlot}</div>}
      {/* 标题:主公选将 / P<n> 选将中 */}
      <div className={selectTitle}>{isLord ? '主公选将' : `P${charSelectTarget} 选将中`}</div>
      {isLord && <div className={subHint}>主公已亮明身份</div>}
      {isSelfSelecting && !isLord && <div className={subHint}>你正在选将(他人不可见你的选择)</div>}
      {!isLord && !isSelfSelecting && <div className={subHint}>选将保密</div>}

      {/* 主公已选武将(主公身份公开,选将结果所有人可见) */}
      {!isLord && lordCharacter && (
        <div className={lordPickedHint}>主公已选择: {lordCharacter}</div>
      )}

      {/* 倒计时进度条 */}
      <div className={countdownWrap}>
        <CountdownBar deadline={deadline} totalMs={totalMs} />
      </div>

      {/* 自身信息区:身份牌 + 座次 */}
      <div className={selfInfoRow}>
        {viewerColor && viewerIdentity && (
          <div
            className={identityBadge}
            style={{ '--viewer-color': viewerColor } as React.CSSProperties}
          >
            <div className={badgeLabel}>你的身份</div>
            <div className={badgeValue}>{viewerIdentity}</div>
          </div>
        )}
        <div className={seatBadge}>
          <div className={badgeLabel}>你的座次</div>
          <div className={badgeValue}>P{viewer}</div>
        </div>
      </div>

      {isSelfSelecting ? (
        <>
          {/* 候选网格(最多 5 列) */}
          <div
            className={candidateGrid}
            style={{ '--cols': Math.min(candidates.length, 5) } as React.CSSProperties}
          >
            {candidates.map((ch, i) => {
              const isSelected = selectedCharIdx === i;
              // 已提交后:选中的武将高亮锁定,其他候选变灰不可点
              const isLockedOut = submittedChar !== null && submittedChar !== ch.name;
              const isSubmittedPick = submittedChar === ch.name;
              const meta = getCharacterMeta(ch.name);
              const faction = meta?.faction ?? '群';
              const maxHealth = meta?.maxHealth ?? 4;
              const charImg = getCharacterImage(ch.name);
              return (
                <div
                  key={ch.name}
                  className={cx(
                    candidateCard,
                    (isSelected || isSubmittedPick) && candidateCardSelected,
                    isLockedOut && candidateCardLockedOut,
                    submittedChar !== null && candidateCardFrozen,
                  )}
                  style={
                    { '--faction-color': FACTION_BG[faction] || '#333' } as React.CSSProperties
                  }
                  onClick={() => {
                    if (submittedChar !== null) return; // 已提交,禁止重选
                    setSelectedCharIdx(i);
                  }}
                >
                  {charImg && (
                    <div className={candidatePortrait} aria-hidden>
                      <img
                        className={candidatePortraitImg}
                        src={charImg}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  <div className={candidateName}>{ch.name}</div>
                  <div className={cx(candidateFaction)}>
                    {faction} · {ch.skills.map((s, si) => (
                      <SkillTag key={s} name={s} description={getSkillDescription(s)}>
                        {si > 0 ? ' / ' : ''}{s}
                      </SkillTag>
                    ))}
                  </div>
                  <div className={hpDots}>
                    {Array.from({ length: maxHealth }, (_, j) => (
                      <div key={j} className={hpDot} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 确认按钮:提交后锁定为「已选择 XXX」,禁止重复提交 */}
          <button
            className={cx(
              confirmBtn,
              submittedChar !== null
                ? confirmBtnSubmitted
                : selectedCharIdx !== null
                  ? confirmBtnReady
                  : confirmBtnIdle,
            )}
            disabled={submittedChar !== null || selectedCharIdx === null}
            onClick={() => {
              if (submittedChar !== null) return;
              if (selectedCharIdx !== null && candidates[selectedCharIdx]) {
                const picked = candidates[selectedCharIdx].name;
                setSubmittedChar(picked); // 锁定,禁止重选
                setSelectedCharIdx(null);
                onSelect(picked);
              }
            }}
          >
            {submittedChar !== null ? `✅ 已选择 ${submittedChar}` : '确认选择'}
          </button>
        </>
      ) : isLord ? (
        <div className={waitingHint}>主公正在选将，请等待...</div>
      ) : (
        <div className={waitingHint}>等待 P{charSelectTarget} 选将...</div>
      )}
    </div>
  );
}

// ─── Styles ───
const overlayRoot = css`
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);
`;

const overlaySlotWrap = css`
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 10000;
`;

const selectTitle = css`
  font-size: 24px;
  font-weight: bold;
  color: #ffd700;
  margin-bottom: 8px;
  letter-spacing: 4px;
`;

const subHint = css`
  font-size: 14px;
  color: #aaa;
  margin-bottom: 8px;
`;

const lordPickedHint = css`
  font-size: 15px;
  color: #ffd700;
  margin-bottom: 8px;
  font-weight: bold;
`;

const countdownWrap = css`
  width: 300px;
  margin-bottom: 24px;
`;

const selfInfoRow = css`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
`;

const identityBadge = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 18px;
  border-radius: 8px;
  background: var(--viewer-color);
  color: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  min-width: 90px;
`;

const seatBadge = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 18px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  min-width: 90px;
`;

const badgeLabel = css`
  font-size: 11px;
  opacity: 0.85;
  letter-spacing: 2px;
`;

const badgeValue = css`
  font-size: 20px;
  font-weight: bold;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
`;

const candidateGrid = css`
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 16px;
  max-width: 800px;
  width: 90%;
`;

const candidateCard = css`
  background: var(--faction-color);
  border-radius: 12px;
  padding: 12px 12px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  border: 3px solid transparent;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  transform: translateY(0);
  transition: all 0.25s cubic-bezier(0.23, 1, 0.32, 1);
  opacity: 1;
  filter: none;

  &:hover {
    transform: translateY(-6px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  }
`;

// 候选武将卡顶部的立绘区:按比例裁切,不拉伸变形
const candidatePortrait = css`
  position: relative;
  width: 100%;
  height: 220px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
`;
const candidatePortraitImg = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
`;

const candidateCardSelected = css`
  border: 3px solid #ffd700;
  box-shadow:
    0 0 20px rgba(255, 215, 0, 0.4),
    0 4px 16px rgba(0, 0, 0, 0.3);
  transform: translateY(-8px) scale(1.03);

  &:hover {
    transform: translateY(-8px) scale(1.03);
    box-shadow:
      0 0 20px rgba(255, 215, 0, 0.4),
      0 4px 16px rgba(0, 0, 0, 0.3);
  }
`;

const candidateCardLockedOut = css`
  opacity: 0.35;
  filter: grayscale(0.8);
  cursor: default;
`;

const candidateCardFrozen = css`
  cursor: default;

  &:hover {
    transform: translateY(0);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }
`;

const candidateName = css`
  font-size: 22px;
  font-weight: bold;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
`;

const candidateFaction = css`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 2px 8px;
`;

const hpDots = css`
  display: flex;
  gap: 3px;
  margin-top: 4px;
`;

const hpDot = css`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #e74c3c;
  box-shadow: 0 0 4px rgba(231, 76, 60, 0.5);
`;

const confirmBtn = css`
  margin-top: 32px;
  padding: 12px 56px;
  font-size: 18px;
  font-weight: bold;
  border: none;
  border-radius: 8px;
  transition: all 0.2s;
  letter-spacing: 2px;
`;

const confirmBtnIdle = css`
  color: #666;
  background: #333;
  cursor: not-allowed;
  box-shadow: none;
`;

const confirmBtnReady = css`
  color: #000;
  background: linear-gradient(135deg, #ffd700, #f0c000);
  box-shadow: 0 4px 16px rgba(255, 215, 0, 0.3);
  cursor: pointer;
`;

const confirmBtnSubmitted = css`
  color: #fff;
  background: linear-gradient(135deg, #27ae60, #1e8449);
  box-shadow: 0 4px 16px rgba(39, 174, 96, 0.4);
  cursor: not-allowed;
`;

const waitingHint = css`
  font-size: 18px;
  color: #aaa;
  margin-top: 32px;
`;
