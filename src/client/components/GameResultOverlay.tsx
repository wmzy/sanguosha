// 游戏结算面板:gameOver 消息到达后揭晓全场身份 + 显示获胜阵营 + 逐人胜负。
// 由 useDebugMultiConnection / useMultiplayerRoom 收到 { type:'gameOver', winner } 触发。
// DebugLobby 与 MultiplayerPage 共用本组件。
//
// winner 语义(与 session.handleGameOver 对齐):
//   - '无人' :平局/无人获胜(开局即结束等)
//   - 座次号字符串:该座次玩家所属阵营获胜
//     主公/忠臣 → 主公方;反贼 → 反贼;内奸 → 内奸

import type { GameView } from '../../engine/types';
import { css, cx } from '@linaria/core';
import { IDENTITY_COLORS, FACTION_BG } from './gameViewConstants';

export interface GameResultOverlayProps {
  /** 胜方:座次号字符串,或 '无人' */
  winner: string;
  players: GameView['players'];
  /** 当前视角座次(高亮己方、判断本人胜负) */
  perspectiveIdx: number;
  /** 再来一局:重置房间回「配置+准备」阶段 */
  onRestart: () => void;
  /** 退出房间(返回大厅) */
  onExit: () => void;
  /** 下载录像(可选;调试/多人模式传入) */
  onDownloadReplay?: () => void;
}

/** 身份 → 阵营 */
type Camp = '主公方' | '反贼' | '内奸';

function identityCamp(identity?: string): Camp | null {
  switch (identity) {
    case '主公':
    case '忠臣':
      return '主公方';
    case '反贼':
      return '反贼';
    case '内奸':
      return '内奸';
    default:
      return null;
  }
}

const CAMP_LABEL: Record<Camp, string> = {
  主公方: '主公与忠臣获胜',
  反贼: '反贼获胜',
  内奸: '内奸获胜',
};

/** 根据胜方座次推断获胜阵营 */
function winningCampOf(winner: string, players: GameView['players']): Camp | null {
  if (winner === '无人') return null;
  const p = players[Number(winner)];
  return identityCamp(p?.identity);
}

export function GameResultOverlay({
  winner,
  players,
  perspectiveIdx,
  onRestart,
  onExit,
  onDownloadReplay,
}: GameResultOverlayProps) {
  const isDraw = winner === '无人';
  const winCamp = winningCampOf(winner, players);
  const campLabel = isDraw ? '平局' : winCamp ? CAMP_LABEL[winCamp] : '游戏结束';
  const campColor = isDraw
    ? '#999'
    : (IDENTITY_COLORS[players[Number(winner)]?.identity ?? ''] ?? '#ccc');

  // 本人胜负(旁观者 perspectiveIdx<0 时为 null)
  const me = perspectiveIdx >= 0 ? players[perspectiveIdx] : undefined;
  const myCamp = identityCamp(me?.identity);
  const iWon: boolean | null =
    isDraw || !me ? null : myCamp !== null && myCamp === winCamp;

  return (
    <div className={overlayRoot}>
      <div className={resultCard} style={{ '--camp-color': campColor } as React.CSSProperties}>
        <div className={endLabel}>游戏结束</div>
        <div className={campName}>{campLabel}</div>

        {/* 本人胜负横幅 */}
        {iWon !== null && (
          <div className={cx(personalBanner, iWon ? personalWin : personalLose)}>
            {iWon ? '🎉 胜利' : '💀 失败'}
          </div>
        )}

        <div className={playerList}>
          {/* 表头与数据行共用同一 grid 模板,列宽完全一致 */}
          <div className={cx(rowGrid, listHeader)}>
            <span />
            <span>玩家</span>
            <span>武将</span>
            <span className={hdrCenter}>身份</span>
            <span className={hdrCenter}>体力</span>
            <span className={hdrCenter}>结果</span>
          </div>
          {players.map((p, i) => {
            const idColor = IDENTITY_COLORS[p.identity ?? ''] ?? '#888';
            const isMe = i === perspectiveIdx;
            const pCamp = identityCamp(p.identity);
            const pWon: boolean | null =
              isDraw ? null : pCamp !== null && pCamp === winCamp;
            return (
              <div
                key={i}
                className={cx(
                  rowGrid,
                  playerRow,
                  isMe && playerRowMe,
                  pWon === true && playerRowWon,
                  pWon === false && playerRowLost,
                )}
              >
                <span className={cx(rowStar, isMe && rowStarMe)}>{isMe ? '★' : ''}</span>
                <span className={cx(rowName, isMe && rowNameMe)}>
                  {p.faction && (
                    <span
                      className={factionTag}
                      style={{ '--fac-bg': FACTION_BG[p.faction] ?? '#555' } as React.CSSProperties}
                    >
                      {p.faction}
                    </span>
                  )}
                  {p.name}
                </span>
                <span className={rowChar}>{p.character || '—'}</span>
                <span
                  className={rowIdentityTag}
                  style={{ '--id-color': idColor } as React.CSSProperties}
                >
                  {p.identity ?? '—'}
                </span>
                <span className={rowHp}>
                  {p.alive ? `${p.health}/${p.maxHealth}` : '阵亡'}
                </span>
                <span className={cx(rowResult, pWon === true && resultWin, pWon === false && resultLose)}>
                  {pWon === null ? '—' : pWon ? '胜' : '负'}
                </span>
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
  min-width: 420px;
  max-width: 560px;
  padding: 32px 40px;
  border-radius: 16px;
  background: linear-gradient(160deg, #2a2a35, #1a1a22);
  border: 2px solid var(--camp-color);
  box-shadow: 0 0 60px color-mix(in srgb, var(--camp-color) 33%, transparent);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`;

const endLabel = css`
  font-size: 14px;
  letter-spacing: 4px;
  opacity: 0.6;
`;

const campName = css`
  font-size: 32px;
  font-weight: bold;
  color: var(--camp-color);
  text-shadow: 0 2px 12px color-mix(in srgb, var(--camp-color) 53%, transparent);
`;

const personalBanner = css`
  padding: 6px 28px;
  border-radius: 20px;
  font-size: 18px;
  font-weight: bold;
  letter-spacing: 2px;
`;

const personalWin = css`
  background: rgba(39, 174, 96, 0.2);
  border: 1px solid #27ae60;
  color: #2ecc71;
`;

const personalLose = css`
  background: rgba(231, 76, 60, 0.15);
  border: 1px solid #c0392b;
  color: #e74c3c;
`;

const playerList = css`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
`;

/** 表头 + 数据行共用的 grid 模板,保证 6 列严格对齐。
 *  列: star(16) / name(min90~auto) / char(1fr) / identity(56) / hp(44) / result(28) */
const rowGrid = css`
  display: grid;
  grid-template-columns: 16px minmax(90px, auto) 1fr 56px 44px 28px;
  align-items: center;
  gap: 4px 10px;
  padding: 8px 12px;
`;

const listHeader = css`
  padding: 4px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 1px;
`;

/** 表头中需与数据单元格(居中)对齐的列标签 */
const hdrCenter = css`
  text-align: center;
`;

const playerRow = css`
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  border-left-width: 3px;
  transition: background 0.2s;
`;

const playerRowMe = css`
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
`;

const playerRowWon = css`
  border-left-color: #27ae60;
`;

const playerRowLost = css`
  opacity: 0.5;
  border-left-color: #555;
`;

const rowStar = css`
  text-align: center;
`;

const rowStarMe = css`
  color: #ffd700;
`;

const rowName = css`
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
`;

const rowNameMe = css`
  font-weight: bold;
`;

const factionTag = css`
  display: inline-block;
  width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  border-radius: 3px;
  font-size: 12px;
  font-weight: bold;
  color: #fff;
  background: var(--fac-bg);
  flex-shrink: 0;
`;

const rowChar = css`
  opacity: 0.7;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const rowIdentityTag = css`
  padding: 2px 0;
  border-radius: 4px;
  font-size: 13px;
  font-weight: bold;
  color: #fff;
  background: var(--id-color, #555);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  text-align: center;
  justify-self: center;
  min-width: 36px;
`;

const rowHp = css`
  font-size: 13px;
  opacity: 0.7;
  text-align: center;
`;

const rowResult = css`
  font-size: 13px;
  font-weight: bold;
  text-align: center;
`;

const resultWin = css`
  color: #2ecc71;
`;

const resultLose = css`
  color: #888;
`;

const actionRow = css`
  display: flex;
  gap: 14px;
  margin-top: 8px;
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
  background: #3498db;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: filter 0.2s;

  &:hover {
    filter: brightness(1.15);
  }
`;
