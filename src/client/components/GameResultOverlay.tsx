// 游戏结算面板:gameOver 消息到达后揭晓全场身份 + 显示获胜阵营 + 逐人胜负。
// 由 useDebugMultiConnection / useMultiplayerRoom 收到 { type:'gameOver', winner } 触发。
// DebugLobby 与 MultiplayerPage 共用本组件。
//
// winner 语义(与 session.handleGameOver 对齐):
//   - '无人' :平局/无人获胜(开局即结束等)
//   - 座次号字符串:该座次玩家所属阵营获胜
//     主公/忠臣 → 主公方;反贼 → 反贼;内奸 → 内奸

import type { GameView } from '../../engine/types';
import type { BattleStats } from '../utils/battleStats';
import { css, cx } from '@linaria/core';
import { IDENTITY_COLORS, FACTION_BG } from './gameViewConstants';
import { audioEngine } from '../sounds/audioEngine';
import { useEffect, useRef, useState } from 'react';

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
  /** 战报统计(可选;多人/调试模式从事件流累计)。传入时表格追加 伤害/承伤/击杀 三列 */
  stats?: BattleStats;
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
  stats,
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

  // 胜负音效:组件挂载时播放一次(胜负结果揭晓)
  const soundPlayed = useRef(false);
  useEffect(() => {
    if (soundPlayed.current) return;
    soundPlayed.current = true;
    if (isDraw) return;
    if (iWon === null) return; // 旁观者不播音
    audioEngine.play(iWon ? 'win' : 'lose', 0.6);
  }, [isDraw, iWon]);

  // 官方式「点击空白处关闭」:仅收起结算卡(回到终局桌面),不退出房间
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      className={overlayRoot}
      onClick={(e) => {
        if (e.target === e.currentTarget) setDismissed(true);
      }}
    >
      <div
        className={cx(resultCard, stats && resultCardWide)}
        style={{ '--camp-color': campColor } as React.CSSProperties}
      >
        {/* 胜负大字横幅:金书风「胜利/失败」压红绸带,对齐官方 p9 结算样式 */}
        {!isDraw && (
          <div className={victoryBannerWrap}>
            <span className={victoryRibbon} aria-hidden />
            <span className={cx(victoryText, iWon === false && victoryTextLose)}>
              {iWon === false ? '失　败' : '胜　利'}
            </span>
          </div>
        )}
        <div className={campName}>{campLabel}</div>

        {/* 本人胜负已由大字横幅表达,不再重复显示小横幅 */}

        <div className={playerList}>
          {/* 表头与数据行共用同一 grid 模板,列宽完全一致 */}
          <div className={cx(stats ? rowGridWide : rowGrid, listHeader)}>
            <span />
            <span>玩家</span>
            <span>武将</span>
            <span className={hdrCenter}>身份</span>
            <span className={hdrCenter}>体力</span>
            {/* 战报列(仅 stats 传入时渲染,与数据行走同一分支保持对齐) */}
            {stats && (
              <>
                <span className={hdrCenter}>伤害</span>
                <span className={hdrCenter}>承伤</span>
                <span className={hdrCenter}>击杀</span>
              </>
            )}
            <span className={hdrCenter}>结果</span>
          </div>
          {players.map((p, i) => {
            const idColor = IDENTITY_COLORS[p.identity ?? ''] ?? '#888';
            const isMe = i === perspectiveIdx;
            const pCamp = identityCamp(p.identity);
            const pWon: boolean | null =
              isDraw ? null : pCamp !== null && pCamp === winCamp;
            // 本座次战报条目(stats 未覆盖的座次按 0 展示)
            const st = stats?.[i];
            return (
              <div
                key={i}
                className={cx(
                  stats ? rowGridWide : rowGrid,
                  playerRow,
                  isMe && playerRowMe,
                  pWon === true && playerRowWon,
                  pWon === false && playerRowLost,
                )}
                title={st ? `本局回合数:${st.turns}` : undefined}
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
                {stats && (
                  <>
                    <span className={rowStat}>{st?.damageDealt ?? 0}</span>
                    <span className={rowStat}>{st?.damageTaken ?? 0}</span>
                    <span className={rowStat}>{st?.kills ?? 0}</span>
                  </>
                )}
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
      {/* 官方式提示:点击空白处关闭(仅收起结算卡,不退出房间) */}
      <div className={dismissHint}>点击空白处关闭</div>
    </div>
  );
}

/* ───────── 样式定义 ───────── */

const overlayRoot = css`
  position: fixed;
  inset: 0;
  z-index: 10100;
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

/** 战报版结算卡:多三列数据,放宽宽度上下限避免武将列被挤没 */
const resultCardWide = css`
  min-width: 520px;
  max-width: 640px;
`;

/* ── 官方式胜负大字横幅:红绸带压金书大字(p9「胜 利」)── */
const victoryBannerWrap = css`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0;
`;

/** 红绸带:横贯全宽的红色缎带,微透视+两端暗角 */
const victoryRibbon = css`
  position: absolute;
  left: -40px; /* 出血到卡边,模拟横幅贯穿 */
  right: -40px;
  top: 50%;
  height: 34px;
  transform: translateY(-50%);
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.35), transparent 12%, transparent 88%, rgba(0, 0, 0, 0.35)),
    linear-gradient(180deg, #c0392b 0%, #8a1f16 55%, #6e150d 100%);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  pointer-events: none;
`;

/** 金书大字:粗衬线感金色大字,深色描边浮于绸带上 */
const victoryText = css`
  position: relative;
  z-index: 1;
  font-size: 44px;
  font-weight: 900;
  letter-spacing: 10px;
  text-indent: 10px;
  color: #ffd700;
  background: linear-gradient(180deg, #ffe9a0 20%, #ffb400 55%, #cc8800 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 2px 1px rgba(60, 20, 0, 0.85)) drop-shadow(0 0 18px rgba(255, 160, 30, 0.45));
`;

/** 失败态:银灰冷色大字 */
const victoryTextLose = css`
  color: #aab4bd;
  background: linear-gradient(180deg, #dfe6ec 20%, #93a3b0 55%, #5d6b76 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 2px 1px rgba(0, 15, 30, 0.85)) drop-shadow(0 0 18px rgba(120, 160, 200, 0.35));
`;

/** 「点击空白处关闭」提示:卡片下方弱化小字(官方式) */
const dismissHint = css`
  position: absolute;
  bottom: 26px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12px;
  letter-spacing: 3px;
  color: rgba(255, 255, 255, 0.45);
  pointer-events: none;
`;

const campName = css`
  font-size: 32px;
  font-weight: bold;
  color: var(--camp-color);
  text-shadow: 0 2px 12px color-mix(in srgb, var(--camp-color) 53%, transparent);
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

/** 战报版 9 列 grid 模板(传入 stats 时表头/数据行统一切换,列严格对齐)。
 *  列: star(16) / name(min80~auto) / char(1fr) / identity(48) / hp(40)
 *      / damage(36) / taken(36) / kills(30) / result(26) */
const rowGridWide = css`
  display: grid;
  grid-template-columns: 16px minmax(80px, auto) 1fr 48px 40px 36px 36px 30px 26px;
  align-items: center;
  gap: 4px 8px;
  padding: 8px 12px;
`;

/** 战报数据单元格(伤害/承伤/击杀):居中,弱化色 */
const rowStat = css`
  text-align: center;
  color: rgba(255, 255, 255, 0.75);
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
