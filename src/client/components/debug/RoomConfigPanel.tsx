// src/client/components/debug/RoomConfigPanel.tsx — 房间配置 + 准备面板
//
// 调试房间创建后、游戏开始前显示。
// 房主(调试房间=任意玩家)可修改房间名/将池/倒计时/手牌数。
// 每个座次一个「准备」按钮;全部准备后显示「开始」按钮。
// debug 模式下用户切换到对应座次视角执行准备/开始。

import { useState, useMemo, useCallback } from 'react';
import { css, cx } from '@linaria/core';
import type { RoomConfig } from '../../../server/protocol';
import { colors } from '../../theme';
import { ChatConfigSection } from '../ChatConfigSection';
import { ErrorToast } from '../../pages/multiplayer/ErrorToast';
// 公共配置字段(房间名/将池/倒计时/手牌数)与等待大厅(RoomConfigSection)共用同一出处
import {
  RoomNameField,
  RoomCharPoolField,
  RoomTimeoutField,
  RoomHandSizeField,
  type RoomConfigField,
} from '../../pages/multiplayer/RoomConfigFields';

interface RoomConfigPanelProps {
  /** 当前房间配置 */
  config: RoomConfig;
  /** 已准备的 playerId 列表 */
  readyPlayers: string[];
  /** 所有玩家 playerId(按连接顺序) */
  playerIds: string[];
  /** 座次→playerId 映射(本地座次索引 → playerId) */
  seatPlayerIds: Map<number, string>;
  maxPlayers: number;
  /** 已连接座次数 */
  connectedCount: number;
  /** 当前视角座次(用于高亮当前座次) */
  perspective: number;
  /** 切换视角 */
  onSwitchPerspective: (seat: number) => void;
  /** 指定座次准备 */
  onReady: (seat: number) => void;
  /** 指定座次取消准备 */
  onCancelReady: (seat: number) => void;
  /** 开始游戏 */
  onStart: () => void;
  /** 更新配置 */
  onUpdateConfig: (config: RoomConfig) => void;
  /** 退出/删除房间 */
  onExit: () => void;
  /** 错误提示 */
  error: string | null;
}

const page = css`
  min-height: 100vh;
  background-color: ${colors.bg.page};
  color: ${colors.text.primary};
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const card = css`
  background-color: ${colors.bg.panel};
  border-radius: 12px;
  padding: 32px;
  width: 100%;
  max-width: 560px;
`;

const title = css`
  font-size: 24px;
  margin: 0 0 8px;
  text-align: center;
`;

const subtitle = css`
  color: ${colors.text.muted};
  text-align: center;
  margin: 0 0 24px;
  font-size: 14px;
`;

const formGroup = css`
  margin-bottom: 18px;
`;

const label = css`
  display: block;
  margin-bottom: 6px;
  color: ${colors.text.secondary};
  font-size: 13px;
`;

const input = css`
  width: 100%;
  padding: 10px 12px;
  background-color: ${colors.bg.input};
  border: 1px solid #444;
  border-radius: 6px;
  color: ${colors.text.input};
  font-size: 14px;
  box-sizing: border-box;
  &:focus {
    outline: none;
    border-color: ${colors.accent.blue};
  }
`;

const row = css`
  display: flex;
  gap: 12px;
  & > * {
    flex: 1;
  }
`;

const seatsGrid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 24px;
`;

const seatCardBase = css`
  background-color: ${colors.bg.playerOther};
  border: 2px solid #333;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
  cursor: pointer;
  opacity: 1;
`;

const seatCurrent = css`
  background-color: ${colors.bg.playerSelf};
  border-color: ${colors.accent.blue};
`;

const seatReadyCls = css`
  border-color: ${colors.accent.green};
`;

const seatDisconnected = css`
  opacity: 0.4;
`;

const seatLabel = css`
  font-size: 13px;
  color: ${colors.text.secondary};
  margin-bottom: 8px;
`;

const readyBadge = css`
  color: ${colors.accent.green};
  font-size: 12px;
  font-weight: bold;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const btnCancelReady = css`
  padding: 2px 8px;
  background-color: ${colors.disabled};
  color: ${colors.text.secondary};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
`;

const pendingBadge = css`
  color: ${colors.text.muted};
  font-size: 12px;
`;

const btnReady = css`
  width: 100%;
  padding: 6px;
  background-color: ${colors.accent.greenDark};
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
`;

const actionsRow = css`
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 8px;
`;

const btnPrimary = css`
  padding: 14px 40px;
  background-color: ${colors.accent.orange};
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
`;

const btnPrimaryDisabled = css`
  padding: 14px 40px;
  background-color: ${colors.disabled};
  color: ${colors.text.muted};
  border: none;
  border-radius: 8px;
  cursor: not-allowed;
  font-size: 16px;
  font-weight: bold;
`;

const btnSecondary = css`
  padding: 14px 24px;
  background-color: transparent;
  color: ${colors.text.secondary};
  border: 1px solid #555;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
`;

/** 「等待全部准备」禁用时按钮下方的进度原因说明 */
const waitHint = css`
  margin-top: 10px;
  font-size: 13px;
  color: ${colors.text.dim};
`;

export function RoomConfigPanel({
  config,
  readyPlayers,
  seatPlayerIds,
  maxPlayers,
  connectedCount,
  perspective,
  onSwitchPerspective,
  onReady,
  onCancelReady,
  onStart,
  onUpdateConfig,
  onExit,
  error,
}: RoomConfigPanelProps) {
  // 本地编辑状态(未提交)
  const [editConfig, setEditConfig] = useState<RoomConfig>(config);

  const handleField = useCallback(<K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => {
    setEditConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  // 公共字段提交层:输入框字段(房间名/手牌数)失焦即同步提交;
  // 下拉字段(将池/倒计时)选中即提交,但延后到当前事件之后(setTimeout 0,
  // 保留原有「select 立即提交」语义,不进共享字段组件)。
  const handleFieldCommit = useCallback(
    (field: RoomConfigField, next: RoomConfig) => {
      if (field === 'charPool' || field === 'timeoutSec') {
        setTimeout(() => onUpdateConfig(next), 0);
      } else {
        onUpdateConfig(next);
      }
    },
    [onUpdateConfig],
  );

  // 全部座次已连接 + 全部准备
  const allSeatsReady = useMemo(() => {
    if (connectedCount < maxPlayers) return false;
    // 检查每个座次的 playerId 是否在 readyPlayers
    for (let i = 0; i < maxPlayers; i++) {
      const pid = seatPlayerIds.get(i);
      if (!pid || !readyPlayers.includes(pid)) return false;
    }
    return true;
  }, [connectedCount, maxPlayers, seatPlayerIds, readyPlayers]);

  // 「等待全部准备」禁用原因:优先报连接进度,其次列出未准备座次
  const waitingReason = useMemo(() => {
    if (connectedCount < maxPlayers) return `等待连接 ${connectedCount}/${maxPlayers}…`;
    const notReadySeats: number[] = [];
    for (let i = 0; i < maxPlayers; i++) {
      const pid = seatPlayerIds.get(i);
      if (!pid || !readyPlayers.includes(pid)) notReadySeats.push(i + 1);
    }
    return notReadySeats.length > 0
      ? `等待座次 ${notReadySeats.join('、')} 准备…`
      : '等待全部准备…';
  }, [connectedCount, maxPlayers, seatPlayerIds, readyPlayers]);

  return (
    <div className={page}>
      <div className={card}>
        <h2 className={title}>房间配置</h2>
        <p className={subtitle}>配置完成后,切换到每个座次视角点「准备」。全部准备后可开始。</p>

        {/* 房间名/将池/倒计时/手牌数:公共字段组件,与等待大厅(RoomConfigSection)共用 */}
        <div className={formGroup}>
          <RoomNameField
            config={editConfig}
            onFieldChange={handleField}
            onCommit={handleFieldCommit}
            labelCls={label}
            inputCls={input}
          />
        </div>

        <div className={row}>
          <div className={formGroup}>
            <RoomCharPoolField
              config={editConfig}
              onFieldChange={handleField}
              onCommit={handleFieldCommit}
              labelCls={label}
              inputCls={input}
            />
          </div>
          <div className={formGroup}>
            <RoomTimeoutField
              config={editConfig}
              onFieldChange={handleField}
              onCommit={handleFieldCommit}
              labelCls={label}
              inputCls={input}
            />
          </div>
          <div className={formGroup}>
            <RoomHandSizeField
              config={editConfig}
              onFieldChange={handleField}
              onCommit={handleFieldCommit}
              labelCls={label}
              inputCls={input}
            />
          </div>
        </div>

        {/* 聊天配置 */}
        <ChatConfigSection
          config={editConfig.chat}
          onChange={(chat) => {
            const updated = { ...editConfig, chat };
            setEditConfig(updated);
            onUpdateConfig(updated);
          }}
        />

        {/* 座次列表 */}
        <label className={label}>
          座次与准备 ({connectedCount}/{maxPlayers} 已连接)
        </label>
        <div className={seatsGrid}>
          {Array.from({ length: maxPlayers }, (_, i) => {
            const pid = seatPlayerIds.get(i);
            const isReady = pid ? readyPlayers.includes(pid) : false;
            const isConnected = !!pid;
            const isCurrent = i === perspective;
            return (
              <div
                key={i}
                className={cx(
                  seatCardBase,
                  isCurrent && seatCurrent,
                  isReady && seatReadyCls,
                  !isConnected && seatDisconnected,
                )}
                onClick={() => onSwitchPerspective(i)}
              >
                <div className={seatLabel}>座次 {i + 1}</div>
                {isConnected && isReady && (
                  <div className={readyBadge}>
                    ✓ 已准备
                    <button
                      className={btnCancelReady}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancelReady(i);
                      }}
                    >
                      取消
                    </button>
                  </div>
                )}
                {isConnected && !isReady && (
                  <button
                    className={btnReady}
                    onClick={(e) => {
                      e.stopPropagation();
                      onReady(i);
                    }}
                  >
                    准备
                  </button>
                )}
                {!isConnected && <div className={pendingBadge}>连接中…</div>}
              </div>
            );
          })}
        </div>

        {/* 操作按钮 */}
        <div className={actionsRow}>
          {allSeatsReady ? (
            <button className={btnPrimary} onClick={onStart}>
              开始游戏
            </button>
          ) : (
            <button className={btnPrimaryDisabled} disabled>
              等待全部准备
            </button>
          )}
          <button className={btnSecondary} onClick={onExit}>
            退出
          </button>
        </div>
        {!allSeatsReady && <div className={waitHint}>{waitingReason}</div>}
      </div>
      {error && <ErrorToast message={error} />}
    </div>
  );
}
