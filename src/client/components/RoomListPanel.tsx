import { memo } from 'react';
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

export const RoomListPanel = memo(
  ({
    rooms,
    onRefresh,
    onJoin,
    onDelete,
    onSpectate,
    emptyText,
    allowJoinAlways = false,
  }: RoomListPanelProps) => {
    // join 可点条件: 房间未满,且(status 是等待中 或 allowJoinAlways 开启)
    const isJoinable = (room: RoomInfo) => {
      if (room.playerCount >= room.maxPlayers) return false;
      if (allowJoinAlways) return true;
      return room.status === '等待中';
    };
    return (
      <div className={panelRoot}>
        <h2 className={panelTitle}>房间列表</h2>

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
          {rooms.length === 0 ? (
            <div className={emptyTextStyle}>{emptyText ?? '暂无房间'}</div>
          ) : (
            rooms.map((room) => (
              <div key={room.id} className={roomItem}>
                <div className={roomInfo}>
                  <div className={roomName}>{room.name}</div>
                  <div className={roomIdMono}>{room.id}</div>
                  <div className={roomMeta}>
                    {room.playerCount}/{room.maxPlayers} 玩家 | {room.status}
                    {room.spectatorCount ? ` | ${room.spectatorCount} 旁观` : ''}
                  </div>
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
            ))
          )}
        </div>
      </div>
    );
  },
);
