import type { RoomInfo } from '../../server/protocol';
import { colors, styles } from '../theme';

interface RoomListPanelProps {
  rooms: RoomInfo[];
  onRefresh: () => void;
  onJoin: (roomId: string) => void;
  onDelete?: (roomId: string) => void;
  emptyText?: string;
}

export function RoomListPanel({ rooms, onRefresh, onJoin, onDelete, emptyText }: RoomListPanelProps) {
  return (
    <div
      style={{
        backgroundColor: colors.bg.panel,
        borderRadius: 12,
        padding: 30,
        minWidth: 300,
        maxWidth: 400,
      }}
    >
      <h2 style={{ marginBottom: 20 }}>房间列表</h2>

      <div style={{ marginBottom: 15 }}>
        <button
          onClick={onRefresh}
          style={styles.btn(colors.accent.blue, { padding: '8px 16px', fontSize: 13 })}
        >
          刷新列表
        </button>
      </div>

      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {rooms.length === 0 ? (
          <div style={{ color: colors.text.dim, textAlign: 'center', padding: 20 }}>
            {emptyText ?? '暂无房间'}
          </div>
        ) : (
          rooms.map(room => (
            <div
              key={room.id}
              style={{
                backgroundColor: colors.bg.input,
                borderRadius: 8,
                padding: 15,
                marginBottom: 10,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{room.name}</div>
                <div style={{ fontSize: 12, color: colors.text.muted, fontFamily: 'monospace' }}>
                  {room.id}
                </div>
                <div style={{ fontSize: 12, color: colors.text.muted }}>
                  {room.playerCount}/{room.maxPlayers} 玩家 | {room.status}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
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
}
