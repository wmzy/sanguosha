// 游戏结算遮罩:gameOver 消息到达后揭晓全场身份 + 显示获胜阵营。
// 由 useDebugMultiConnection 收到 { type:'gameOver', winner } 触发,
// DebugLobby 在 conn.gameOver 非空时渲染本组件。
//
// winner 语义(与 session.handleGameOver 对齐):
//   - '无人' :平局/无人获胜(开局即结束等)
//   - 座次号字符串:该座次玩家所属阵营获胜
//     主公/忠臣 → 主公方;反贼 → 反贼;内奸 → 内奸

import type { GameView } from '../../engine/types';
import { css, cx } from '@linaria/core';
import { IDENTITY_COLORS } from './gameViewConstants';

export interface GameResultOverlayProps {
  /** 胜方:座次号字符串,或 '无人' */
  winner: string;
  players: GameView['players'];
  /** 当前视角座次(高亮己方) */
  perspectiveIdx: number;
  /** 再来一局:重置房间回「配置+准备」阶段 */
  onRestart: () => void;
  /** 退出房间(返回大厅) */
  onExit: () => void;
  /** 下载录像(可选;调试/多人模式传入) */
  onDownloadReplay?: () => void;
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

export function GameResultOverlay({
  winner,
  players,
  perspectiveIdx,
  onRestart,
  onExit,
  onDownloadReplay,
}: GameResultOverlayProps) {
  const camp = winningCamp(winner, players);
  const campColor =
    winner === '无人'
      ? '#999'
      : (IDENTITY_COLORS[players[Number(winner)]?.identity ?? ''] ?? '#ccc');

  return (
    <div className={overlayRoot}>
      <div className={resultCard} style={{ '--camp-color': campColor } as React.CSSProperties}>
        <div className={endLabel}>游戏结束</div>
        <div className={campName}>{camp}</div>

        <div className={playerList}>
          {players.map((p, i) => {
            const idColor = IDENTITY_COLORS[p.identity ?? ''] ?? '#888';
            const isMe = i === perspectiveIdx;
            return (
              <div
                key={i}
                className={cx(playerRow, isMe && playerRowMe, !p.alive && playerRowDead)}
              >
                <span className={rowStar}>{isMe ? '★' : ''}</span>
                <span className={cx(rowName, isMe && rowNameMe)}>{p.name}</span>
                <span className={rowChar}>{p.character || '—'}</span>
                <span
                  className={rowIdentityTag}
                  style={{ '--id-color': idColor } as React.CSSProperties}
                >
                  {p.identity}
                </span>
                <span className={rowAlive}>{p.alive ? '存活' : '阵亡'}</span>
              </div>
            );
          })}
        </div>

        <div className={actionRow}>
          <button
            className={restartBtn}
            style={{ '--camp-color': campColor } as React.CSSProperties}
            onClick={onRestart}
          >
            再来一局
          </button>
          {onDownloadReplay && (
            <button className={replayBtn} onClick={onDownloadReplay}>
              ⬇ 下载录像
            </button>
          )}
          <button className={exitBtn} onClick={onExit}>
            返回大厅
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────── 样式定义 ───────── */

const overlayRoot = css`
  position: fixed;
  inset: 0;
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.88);
  animation: overlayFadeIn 0.4s ease-out both;
`;

const resultCard = css`
  min-width: 360px;
  max-width: 520px;
  padding: 32px 40px;
  border-radius: 16px;
  background: linear-gradient(160deg, #2a2a35, #1a1a22);
  border: 2px solid var(--camp-color);
  box-shadow: 0 0 60px color-mix(in srgb, var(--camp-color) 33%, transparent);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
`;

const endLabel = css`
  font-size: 14px;
  letter-spacing: 4px;
  opacity: 0.6;
`;

const campName = css`
  font-size: 34px;
  font-weight: bold;
  color: var(--camp-color);
  text-shadow: 0 2px 12px color-mix(in srgb, var(--camp-color) 53%, transparent);
`;

const playerList = css`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
`;

const playerRow = css`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
`;

const playerRowMe = css`
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
`;

const playerRowDead = css`
  opacity: 0.5;
`;

const rowStar = css`
  width: 16px;
  text-align: center;
  color: #ffd700;
`;

const rowName = css`
  flex: 0 0 auto;
  width: 84px;
`;

const rowNameMe = css`
  font-weight: bold;
`;

const rowChar = css`
  flex: 1;
  opacity: 0.7;
`;

const rowIdentityTag = css`
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: bold;
  color: #fff;
  background: var(--id-color);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
`;

const rowAlive = css`
  width: 36px;
  font-size: 12px;
  opacity: 0.6;
`;

const actionRow = css`
  display: flex;
  gap: 14px;
  margin-top: 12px;
`;

const restartBtn = css`
  padding: 10px 32px;
  font-size: 16px;
  font-weight: bold;
  color: #fff;
  background: var(--camp-color);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: filter 0.2s;

  &:hover {
    filter: brightness(1.15);
  }
`;

const exitBtn = css`
  padding: 10px 32px;
  font-size: 16px;
  font-weight: bold;
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.22);
  }
`;

const replayBtn = css`
  padding: 10px 32px;
  font-size: 16px;
  font-weight: bold;
  color: #fff;
  background: ${'#3498db'};
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: filter 0.2s;

  &:hover {
    filter: brightness(1.15);
  }
`;
