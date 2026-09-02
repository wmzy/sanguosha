import { memo, useState } from 'react';
import { css, cx } from '@linaria/core';
import type { RoomInfo } from '../../server/protocol';
import { colors } from '../theme';

/* ── 房间操作按钮:幽灵药丸体系(与游戏内顶栏同语言)──
   形状/字号一致,以色相区分语义:中性(刷新)/金(加入=主操作)/蓝(旁观)/红(删除)。 */
const btnGhost = css`
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  padding: 7px 16px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  color: #cfcabb;
  font-size: 13px;
  line-height: 1.5;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover {
    border-color: rgba(217, 180, 92, 0.65);
    color: #ecd9a8;
    background: rgba(217, 180, 92, 0.08);
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;
const btnGhostGold = css`
  border-color: rgba(217, 180, 92, 0.55);
  color: #ecd9a8;
  background: rgba(217, 180, 92, 0.1);
  &:hover {
    border-color: rgba(240, 205, 120, 0.85);
    background: rgba(217, 180, 92, 0.18);
  }
`;
const btnGhostBlue = css`
  border-color: rgba(82, 150, 220, 0.55);
  color: #7db8e8;
  background: rgba(52, 120, 200, 0.12);
  &:hover {
    border-color: rgba(120, 180, 240, 0.8);
    color: #a5ccf0;
    background: rgba(52, 120, 200, 0.22);
  }
`;
const btnGhostRed = css`
  border-color: rgba(231, 76, 60, 0.5);
  color: #e89a8d;
  background: rgba(231, 76, 60, 0.1);
  &:hover {
    border-color: rgba(240, 120, 100, 0.75);
    color: #f4b8ad;
    background: rgba(231, 76, 60, 0.2);
  }
`;

interface RoomListPanelProps {
  rooms: RoomInfo[];
  onRefresh: () => void;
  onJoin: (roomId: string) => void;
  onDelete?: (roomId: string) => void;
  onSpectate?: (roomId: string) => void;
  emptyText?: string;
  /** 当前玩家身份(用于「我的」tab 过滤 + 房主高亮)。 */
  currentPlayerId?: string | null;
  /**
   * 调试房间专用:status 限制(等待中)不生效,join 按钮始终可点(除非已满)。
   * 普通房间可不传。debug 房间需要这个能力,因为创建后服务端会 fire-and-forget startGame,
   * 状态变成"游戏中",但 debug 设计上仍允许多客户端随时加入观察/代打。
   */
  allowJoinAlways?: boolean;
}

const panelRoot = css`
  background: linear-gradient(rgba(22, 20, 30, 0.85), rgba(14, 13, 20, 0.88));
  border: 1px solid rgba(196, 162, 84, 0.28);
  border-radius: 12px;
  padding: 30px;
  min-width: 300px;
  max-width: 400px;
  box-shadow:
    0 6px 20px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 232, 170, 0.05);
`;

const panelTitle = css`
  margin-bottom: 20px;
`;

const refreshRow = css`
  margin-bottom: 15px;
`;

const scrollList = css`
  max-height: 420px;
  overflow-y: auto;
`;

const emptyTextStyle = css`
  color: ${colors.text.dim};
  text-align: center;
  padding: 20px;
`;

const roomItem = css`
  background: linear-gradient(rgba(30, 27, 40, 0.75), rgba(22, 20, 30, 0.8));
  border: 1px solid rgba(196, 162, 84, 0.18);
  border-radius: 10px;
  padding: 15px;
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  transition: border-color 0.15s, background-color 0.15s;
  &:hover {
    border-color: rgba(217, 180, 92, 0.45);
    background: rgba(38, 34, 48, 0.85);
  }
`;

const roomInfo = css`
  min-width: 0;
  flex: 1;
`;

const roomName = css`
  font-weight: bold;
  margin-bottom: 4px;
`;

const roomIdMono = css`
  font-size: 12px;
  color: ${colors.text.muted};
  font-family: monospace;
`;

const roomMeta = css`
  font-size: 12px;
  color: ${colors.text.muted};
`;

const roomActions = css`
  display: flex;
  gap: 6px;
  flex-shrink: 0;
`;

const tabRow = css`
  display: flex;
  gap: 0;
  margin-bottom: 16px;
  border-bottom: 2px solid ${colors.bg.input};
`;

const tab = css`
  padding: 8px 20px;
  font-size: 14px;
  font-weight: bold;
  color: ${colors.text.muted};
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: color 0.15s, border-color 0.15s;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
`;

const tabActive = css`
  color: ${colors.accent.gold};
  border-bottom-color: ${colors.accent.gold};
`;

const hostBadge = css`
  display: inline-block;
  font-size: 11px;
  color: ${colors.accent.gold};
  background: rgba(241, 196, 15, 0.15);
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
`;

const hostTag = css`
  font-size: 11px;
  color: ${colors.text.secondary};
  margin-top: 2px;
`; 

export const RoomListPanel = memo(
  ({
    rooms,
    onRefresh,
    onJoin,
    onDelete,
    onSpectate,
    emptyText,
    currentPlayerId,
    allowJoinAlways = false,
  }: RoomListPanelProps) => {
    const [activeTab, setActiveTab] = useState<'all' | 'mine'>('all');
    // 加入中防重复:点击「加入/进入」后到组件卸载(进入房间)前,再点不重复触发 onJoin
    const [joiningId, setJoiningId] = useState<string | null>(null);
    const handleJoinClick = (roomId: string) => {
      if (joiningId) return;
      setJoiningId(roomId);
      onJoin(roomId);
    };

    // join 可点条件: 房间未满,且(status 是等待中 或 allowJoinAlways 开启)
    const isJoinable = (room: RoomInfo) => {
      if (room.playerCount >= room.maxPlayers) return false;
      if (allowJoinAlways) return true;
      return room.status === '等待中';
    };

    // 「我的」tab: 房主 === 当前玩家
    const myRoomCount = rooms.filter(
      (r) => r.hostId && currentPlayerId && r.hostId === currentPlayerId,
    ).length;

    const visibleRooms =
      activeTab === 'mine'
        ? rooms.filter((r) => r.hostId && currentPlayerId && r.hostId === currentPlayerId)
        : rooms;

    return (
      <div className={panelRoot}>
        <h2 className={panelTitle}>房间列表</h2>

        {currentPlayerId && (
          <div className={tabRow}>
            <button
              className={`${tab} ${activeTab === 'all' ? tabActive : ''}`}
              onClick={() => setActiveTab('all')}
            >
              全部 ({rooms.length})
            </button>
            <button
              className={`${tab} ${activeTab === 'mine' ? tabActive : ''}`}
              onClick={() => setActiveTab('mine')}
            >
              我的 ({myRoomCount})
            </button>
          </div>
        )}

        <div className={refreshRow}>
          <button onClick={onRefresh} className={btnGhost}>
            刷新列表
          </button>
        </div>

        <div className={scrollList}>
          {visibleRooms.length === 0 ? (
            <div className={emptyTextStyle}>
              {activeTab === 'mine' ? '你还没有创建的房间' : (emptyText ?? '暂无房间')}
            </div>
          ) : (
            visibleRooms.map((room) => {
              const isMyRoom =
                room.hostId && currentPlayerId && room.hostId === currentPlayerId;
              const isInRoom =
                !!(currentPlayerId && room.playerIds?.includes(currentPlayerId));
              return (
                <div key={room.id} className={roomItem}>
                  <div className={roomInfo}>
                    <div className={roomName}>
                      {room.hasPassword && <span title="需要密码" aria-label="密码房间">🔒</span>}
                      {room.name}
                      {isMyRoom && <span className={hostBadge}>我建的</span>}
                    </div>
                    <div className={roomIdMono}>{room.id}</div>
                    <div className={roomMeta}>
                      {room.playerCount}/{room.maxPlayers} 玩家 | {room.status}
                      {room.roomType === 'normal' ? ' | 普通' : ' | 快速'}
                      {room.spectatorCount ? ` | ${room.spectatorCount} 旁观` : ''}
                    </div>
                    {room.hostId && (
                      <div className={hostTag}>
                        房主: {room.playerNames?.[room.hostId] ?? room.hostId}
                      </div>
                    )}
                  </div>
                  <div className={roomActions}>
                    {isInRoom ? (
                      <button
                        onClick={() => handleJoinClick(room.id)}
                        disabled={joiningId === room.id}
                        className={cx(btnGhost, btnGhostGold)}
                      >
                        进入
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => handleJoinClick(room.id)}
                          disabled={!isJoinable(room) || joiningId === room.id}
                          className={cx(btnGhost, btnGhostGold)}
                        >
                          {joiningId === room.id ? '加入中…' : '加入'}
                        </button>
                        {onSpectate && (
                          <button onClick={() => onSpectate(room.id)} className={cx(btnGhost, btnGhostBlue)}>
                            旁观
                          </button>
                        )}
                      </>
                    )}
                    {onDelete && (
                      <button onClick={() => onDelete(room.id)} className={cx(btnGhost, btnGhostRed)}>
                        删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  },
);
