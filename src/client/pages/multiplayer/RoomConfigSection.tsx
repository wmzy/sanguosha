// src/client/pages/multiplayer/RoomConfigSection.tsx
// 等待大厅「房间配置」区块:房主可编辑表单(逐字段 onBlur/onChange 提交)与非房主只读 configGrid 两分支。
// editConfig 由 WaitingStage 持有传入;字段修改走 onFieldChange,提交服务端走 onCommit(= mp.updateConfig)。
import { inputStyle } from '../../theme';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import {
  formRow,
  label,
  configGrid,
  configItem,
  configKey,
  configVal,
  GAME_MODE_OPTIONS,
  GAME_MODE_LABELS,
  POOL_LABELS,
  TIMEOUT_OPTIONS,
  timeoutLabel,
} from './multiplayerStyles';
import type { RoomConfig, CharPoolPreset } from '../../../server/protocol';
import type { GameMode } from '../../../engine/rules/types';

interface RoomConfigSectionProps {
  /** 房主编辑中的房间配置(由 WaitingStage 持有并传入;非房主分支不使用) */
  editConfig: RoomConfig | null;
  /** 修改单个配置字段(仅更新本地编辑态) */
  onFieldChange: <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => void;
  /** 提交配置到服务端(可选同步人数上限) */
  onCommit: (config: RoomConfig, maxPlayers?: number) => void;
}

export function RoomConfigSection({ editConfig, onFieldChange, onCommit }: RoomConfigSectionProps) {
  const mp = useMultiplayerRoomCtx();
  return (
    <>
      {/* 房间配置（所有人可见） */}
      {/* 房间配置：房主可编辑，非房主只读 */}
      {mp.isHost && editConfig ? (
        <>
          <div className={formRow} style={{ marginBottom: '14px' }}>
            <label className={label}>房间名称</label>
            <input
              className={inputStyle}
              type="text"
              value={editConfig.name}
              maxLength={40}
              onChange={(e) => onFieldChange('name', e.target.value)}
              onBlur={() => onCommit(editConfig)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label className={label}>游戏模式</label>
              <select
                className={inputStyle}
                value={editConfig.gameMode}
                onChange={(e) => {
                  const v = e.target.value as GameMode;
                  onFieldChange('gameMode', v);
                  // 1v1 强制两人:同步收紧人数上限
                  const nextMax = v === '1v1' ? 2 : undefined;
                  onCommit({ ...editConfig, gameMode: v }, nextMax);
                }}
              >
                {GAME_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>将池</label>
              <select
                className={inputStyle}
                value={editConfig.charPool}
                onChange={(e) => {
                  const v = e.target.value as CharPoolPreset;
                  onFieldChange('charPool', v);
                  onCommit({ ...editConfig, charPool: v });
                }}
              >
                <option value="standard">标准池 (~32人)</option>
                <option value="extended">扩展池</option>
                <option value="all">全武将 (60人)</option>
              </select>
            </div>
            <div>
              <label className={label}>操作倒计时</label>
              <select
                className={inputStyle}
                value={editConfig.timeoutSec}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onFieldChange('timeoutSec', v);
                  onCommit({ ...editConfig, timeoutSec: v });
                }}
              >
                {TIMEOUT_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {!TIMEOUT_OPTIONS.some((o) => o.value === editConfig.timeoutSec) && (
                  <option value={editConfig.timeoutSec}>
                    {timeoutLabel(editConfig.timeoutSec)}
                  </option>
                )}
              </select>
            </div>
          </div>
          <div className={formRow} style={{ marginBottom: '14px' }}>
            <label className={label}>初始手牌</label>
            <input
              className={inputStyle}
              type="number"
              min={0}
              max={10}
              value={editConfig.handSize}
              onChange={(e) => onFieldChange('handSize', Number(e.target.value))}
              onBlur={() => onCommit(editConfig)}
            />
          </div>
          <div className={formRow} style={{ marginBottom: '14px' }}>
            <label className={label}>玩家数量</label>
            <select
              className={inputStyle}
              value={mp.roomState?.maxPlayers ?? 2}
              onChange={(e) => {
                const v = Number(e.target.value);
                onCommit(editConfig, v);
              }}
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n} 人</option>
              ))}
            </select>
          </div>
        </>
      ) : mp.roomState?.config && (
        <div className={configGrid}>
          <div className={configItem}>
            <span className={configKey}>房间名</span>
            <span className={configVal}>{mp.roomState.config.name}</span>
          </div>
          <div className={configItem}>
            <span className={configKey}>游戏模式</span>
            <span className={configVal}>{GAME_MODE_LABELS[mp.roomState.config.gameMode] ?? mp.roomState.config.gameMode ?? '身份局'}</span>
          </div>
          <div className={configItem}>
            <span className={configKey}>将池</span>
            <span className={configVal}>{POOL_LABELS[mp.roomState.config.charPool] ?? mp.roomState.config.charPool}</span>
          </div>
          <div className={configItem}>
            <span className={configKey}>操作倒计时</span>
            <span className={configVal}>{timeoutLabel(mp.roomState.config.timeoutSec)}</span>
          </div>
          <div className={configItem}>
            <span className={configKey}>初始手牌</span>
            <span className={configVal}>{mp.roomState.config.handSize} 张</span>
          </div>
          <div className={configItem}>
            <span className={configKey}>聊天</span>
            <span className={configVal}>{mp.roomState.config.chat?.enabled ? '开启' : '关闭'}</span>
          </div>
        </div>
      )}
    </>
  );
}
