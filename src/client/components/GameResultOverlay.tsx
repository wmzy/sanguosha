// 游戏结算遮罩:gameOver 消息到达后揭晓全场身份 + 显示获胜阵营。
// 由 useDebugMultiConnection 收到 { type:'gameOver', winner } 触发,
// DebugLobby 在 conn.gameOver 非空时渲染本组件。
//
// winner 语义(与 session.handleGameOver 对齐):
//   - '无人' :平局/无人获胜(开局即结束等)
//   - 座次号字符串:该座次玩家所属阵营获胜
//     主公/忠臣 → 主公方;反贼 → 反贼;内奸 → 内奸

import type { GameView } from '../../engine/types';
import { IDENTITY_COLORS } from './gameViewConstants';

export interface GameResultOverlayProps {
  /** 胜方:座次号字符串,或 '无人' */
  winner: string;
  players: GameView['players'];
  /** 当前视角座次(高亮己方) */
  perspectiveIdx: number;
  onExit: () => void;
}

/** 根据胜方座次身份推断获胜阵营文案 */
function winningCamp(winner: string, players: GameView['players']): string {
  if (winner === '无人') return '无人获胜';
  const idx = Number(winner);
  const p = players[idx];
  if (!p) return '游戏结束';
  switch (p.identity) {
    case '主公':
    case '忠臣':
      return '主公与忠臣获胜';
    case '反贼':
      return '反贼获胜';
    case '内奸':
      return '内奸获胜';
    default:
      return '游戏结束';
  }
}

export function GameResultOverlay({ winner, players, perspectiveIdx, onExit }: GameResultOverlayProps) {
  const camp = winningCamp(winner, players);
  const campColor = winner === '无人'
    ? '#999'
    : IDENTITY_COLORS[players[Number(winner)]?.identity ?? ''] ?? '#ccc';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.88)',
        animation: 'overlayFadeIn 0.4s ease-out both',
      }}
    >
      <div
        style={{
          minWidth: 360,
          maxWidth: 520,
          padding: '32px 40px',
          borderRadius: 16,
          background: 'linear-gradient(160deg, #2a2a35, #1a1a22)',
          border: `2px solid ${campColor}`,
          boxShadow: `0 0 60px ${campColor}55`,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <div style={{ fontSize: 14, letterSpacing: 4, opacity: 0.6 }}>游戏结束</div>
        <div
          style={{
            fontSize: 34,
            fontWeight: 'bold',
            color: campColor,
            textShadow: `0 2px 12px ${campColor}88`,
          }}
        >
          {camp}
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {players.map((p, i) => {
            const idColor = IDENTITY_COLORS[p.identity ?? ''] ?? '#888';
            const isMe = i === perspectiveIdx;
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: isMe ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                  border: isMe ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent',
                  opacity: p.alive ? 1 : 0.5,
                }}
              >
                <span style={{ width: 16, textAlign: 'center', color: '#FFD700' }}>{isMe ? '★' : ''}</span>
                <span style={{ flex: '0 0 auto', width: 84, fontWeight: isMe ? 'bold' : 'normal' }}>{p.name}</span>
                <span style={{ flex: 1, opacity: 0.7 }}>{p.character || '—'}</span>
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 4,
                    fontSize: 13,
                    fontWeight: 'bold',
                    color: '#fff',
                    background: idColor,
                    textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                  }}
                >
                  {p.identity}
                </span>
                <span style={{ width: 36, fontSize: 12, opacity: 0.6 }}>{p.alive ? '存活' : '阵亡'}</span>
              </div>
            );
          })}
        </div>

        <button
          onClick={onExit}
          style={{
            marginTop: 12,
            padding: '10px 56px',
            fontSize: 16,
            fontWeight: 'bold',
            color: '#fff',
            background: 'rgba(255, 255, 255, 0.12)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: 8,
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.22)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)')}
        >
          返回大厅
        </button>
      </div>
    </div>
  );
}
