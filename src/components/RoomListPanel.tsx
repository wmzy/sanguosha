import { memo } from 'react';
import { css } from '@linaria/core';
import type { RoomInfo } from '../../server/protocol';
import { colors, styles } from '../theme';

interface RoomListPanelProps {
  rooms: RoomInfo[];
  onRefresh: () => void;
  onJoin: (roomId: string) => void;
  onDelete?: (roomId: string) => void;
  emptyText?: string;
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

export const RoomListPanel = memo(function RoomListPanel({ rooms, onRefresh, onJoin, onDelete, emptyText }: RoomListPanelProps) {
  return (
    <div className={panelRoot}>
      <h2 className={panelTitle}>房间列表</h2>

      <div className={refreshRow}>
        <button
          onClick={onRefresh}
          style={styles.btn(colors.accent.blue, { padding: '8px 16px', fontSize: 13 })}
        >
          刷新列表
        </button>
      </div>

      <div className={scrollList}>
        {rooms.length === 0 ? (
          <div className={emptyTextStyle}>{emptyText ?? '暂无房间'}</div>
        ) : (
          rooms.map(room => (
            <div key={room.id} className={roomItem}>
              <div className={roomInfo}>
                <div className={roomName}>{room.name}</div>
                <div className={roomIdMono}>{room.id}</div>
                <div className={roomMeta}>
                  {room.playerCount}/{room.maxPlayers} 玩家 | {room.status}
                </div>
              </div>
              <div className={roomActions}>
                <button
                  onClick={() => onJoin(room.id)}
                  disabled={room.status !== '等待中' || room.playerCount >= room.maxPlayers}
                  style={styles.btn(
                    room.status === '等待中' && room.playerCount < room.maxPlayers
                      ? colors.accent.green
                      : colors.text.dim,
                    {
                      padding: '8px 16px',
                      fontSize: 13,
                      cursor:
                        room.status === '等待中' && room.playerCount < room.maxPlayers
                          ? 'pointer'
                          : 'not-allowed',
                    },
                  )}
                >
                  加入
                </button>
                {onDelete && (
                  <button
                    onClick={() => onDelete(room.id)}
                    style={styles.btn(colors.accent.red, { padding: '8px 16px', fontSize: 13 })}
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
});
