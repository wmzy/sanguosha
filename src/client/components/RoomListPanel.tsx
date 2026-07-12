import { memo, useState } from 'react';
import { css } from '@linaria/core';
import type { RoomInfo } from '../../server/protocol';
import { colors, btnStyle } from '../theme';

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
  background-color: ${colors.bg.panel};
  border-radius: 12px;
  padding: 30px;
  min-width: 300px;
  max-width: 400px;
`;

const panelTitle = css`
  margin-bottom: 20px;
`;

const refreshRow = css`
  margin-bottom: 15px;
`;

const scrollList = css`
  max-height: 300px;
  overflow: auto;
`;

const emptyTextStyle = css`
  color: ${colors.text.dim};
  text-align: center;
  padding: 20px;
`;

const roomItem = css`
  background-color: ${colors.bg.input};
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
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
          <button
            onClick={onRefresh}
            className={btnStyle}
            style={
              {
                '--btn-bg': colors.accent.blue,
                '--btn-padding': '8px 16px',
                '--btn-font-size': '13px',
              } as React.CSSProperties
            }
          >
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
              return (
                <div key={room.id} className={roomItem}>
                  <div className={roomInfo}>
                    <div className={roomName}>
                      {room.name}
                      {isMyRoom && <span className={hostBadge}>我建的</span>}
                    </div>
                    <div className={roomIdMono}>{room.id}</div>
                    <div className={roomMeta}>
                      {room.playerCount}/{room.maxPlayers} 玩家 | {room.status}
                      {room.spectatorCount ? ` | ${room.spectatorCount} 旁观` : ''}
                    </div>
                    {room.hostId && (
                      <div className={hostTag}>房主: {room.hostId}</div>
                    )}
                  </div>
                  <div className={roomActions}>
                    <button
                      onClick={() => onJoin(room.id)}
                      disabled={!isJoinable(room)}
                      className={btnStyle}
                      style={
                        {
                          '--btn-bg': isJoinable(room) ? colors.accent.green : colors.text.dim,
                          '--btn-padding': '8px 16px',
                          '--btn-font-size': '13px',
                          '--btn-cursor': isJoinable(room) ? 'pointer' : 'not-allowed',
                        } as React.CSSProperties
                      }
                    >
                      加入
                    </button>
                    {onSpectate && (
                      <button
                        onClick={() => onSpectate(room.id)}
                        className={btnStyle}
                        style={
                          {
                            '--btn-bg': colors.accent.blue,
                            '--btn-padding': '8px 16px',
                            '--btn-font-size': '13px',
                          } as React.CSSProperties
                        }
                      >
                        旁观
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={() => onDelete(room.id)}
                        className={btnStyle}
                        style={
                          {
                            '--btn-bg': colors.accent.red,
                            '--btn-padding': '8px 16px',
                            '--btn-font-size': '13px',
                          } as React.CSSProperties
                        }
                      >
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
