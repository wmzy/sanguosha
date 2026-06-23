// src/client/components/GameLog.tsx
// 游戏日志面板(底部 details)。
// 正常功能(非 debug 专属):记录游戏中发生的事件,供玩家回顾。
// 从 GameView 抽出的纯展示组件。
import * as styles from './gameViewStyles';
import type { GameView } from '../../engine/types';
import { formatTime } from './gameViewConstants';

export interface GameLogProps {
  view: GameView;
}

export function GameLog({ view }: GameLogProps) {
  return (
    <details className={styles.logPanel} open>
      <summary className={styles.logSummary}>📜 游戏日志 ({view.log.length})</summary>
      <div className={styles.logContent}>
        {view.log.length === 0 && <div className={styles.logEmpty}>暂无记录</div>}
        {view.log.slice().reverse().map((entry, i) => {
          // player 是玩家座次下标(数字);映射为名字,系统(-1/负数)显示为「系统」
          const playerName = entry.player >= 0 ? (view.players[entry.player]?.name ?? `P${entry.player}`) : '系统';
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
