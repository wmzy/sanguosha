// src/client/components/GameLog.tsx
// 游戏日志面板(底部 details)。
// 正常功能(非 debug 专属):记录游戏中发生的事件,供玩家回顾。
// 从 GameView 抽出的纯展示组件。
import { memo } from 'react';
import * as styles from './gameViewStyles';
import type { GameView } from '../../engine/types';
import { formatTime } from './gameViewConstants';

export interface GameLogProps {
  view: GameView;
}

function GameLogImpl({ view }: GameLogProps) {
  return (
    <details className={styles.logPanel} open>
      <summary className={styles.logSummary}>📜 游戏日志 ({view.log.length})</summary>
      <div className={styles.logContent}>
        {view.log.length === 0 && <div className={styles.logEmpty}>暂无记录</div>}
        {view.log
          .slice()
          .reverse()
          .map((entry, i) => {
            // player 是玩家座次下标(数字);映射为名字,系统(-1/负数)显示为「系统」
            // 当前视角玩家加「（我）」标志
            const isMe = entry.player === view.viewer;
            // player 在 view.players 内按 index 查找;不够时回退为 P{idx}
            const playerView = view.players.find((p) => p.index === entry.player);
            const playerName =
              entry.player >= 0
                ? `${playerView?.name ?? `P${entry.player}`}${isMe ? '（我）' : ''}`
                : '系统';
            return (
              <div key={i} className={styles.logEntry}>
                <span className={styles.logTime}>{formatTime(entry.time)}</span>
                <span className={styles.logPlayer}>{playerName}</span>
                <span className={styles.logText}>{entry.text}</span>
              </div>
            );
          })}
      </div>
    </details>
  );
}

/** memo: 日志只在条目数/末尾内容/viewer 变化时重渲染,避免每次 view 更新重绘全部日志条目 */
function gameLogPropsEqual(prev: GameLogProps, next: GameLogProps): boolean {
  const a = prev.view;
  const b = next.view;
  // 视角变化后需要重渲染(需要重算「我」标志)
  if (a.viewer !== b.viewer) return false;
  // 玩家名变化后(如选将完成、分配武将事件到达后)也需要重渲染,
  // 避免日志里的 P{idx} 兑换不更新为角色名
  if (a.players.length !== b.players.length) return false;
  for (let i = 0; i < a.players.length; i++) {
    if (a.players[i].name !== b.players[i].name) return false;
  }
  if (a.log.length !== b.log.length) return false;
  if (a.log.length === 0) return true;
  const aLast = a.log[a.log.length - 1];
  const bLast = b.log[b.log.length - 1];
  return aLast.text === bLast.text && aLast.player === bLast.player;
}

export const GameLog = memo(GameLogImpl, gameLogPropsEqual);
