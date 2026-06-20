// src/client/components/CharSelectWaitingOverlay.tsx
// 并行选将期间:当前视角玩家已选完但其他人还在选时显示的全屏等待遮罩。
// 从 GameView.tsx 抽出,样式全部走 gameViewStyles,消除内联 style hardcode。

import type { GameView } from '../../engine/types';
import { CountdownBar } from './CountdownBar';
import * as styles from './gameViewStyles';

export interface CharSelectWaitingOverlayProps {
  view: GameView;
  perspectiveIdx: number;
  perspectiveName: string;
  onSwitchPerspective?: () => void;
}

export function CharSelectWaitingOverlay({
  view, perspectiveIdx, perspectiveName, onSwitchPerspective,
}: CharSelectWaitingOverlayProps) {
  // 从 allCharSelectSlots 取第一个仍在选将的 slot 的 deadline,用于倒计时
  const activeSlot = view.allCharSelectSlots?.find(
    s => s.atom.type === '选将询问' && !view.players[s.target]?.character,
  );
  const selectDeadline = activeSlot?.deadline ?? null;
  const selectTotalMs = activeSlot?.totalMs ?? 60_000;
  const nextName = view.players[(perspectiveIdx + 1) % view.players.length]?.name;
  const selectingNames = view.players.filter(p => !p.character).map(p => p.name).join('、');

  return (
    <div className={styles.charSelectWaitingOverlay}>
      <div>⏳ {perspectiveName} 已选择武将,等待其他玩家选将...</div>
      <div className={styles.charSelectWaitingSub}>{selectingNames} 正在选将</div>
      {/* 选将倒计时 */}
      <div className={styles.charSelectWaitingCountdown}>
        <CountdownBar deadline={selectDeadline} totalMs={selectTotalMs} />
      </div>
      {/* debug 模式:切换到未选玩家代其选将 */}
      {onSwitchPerspective && (
        <button className={styles.charSelectWaitingSwitchBtn} onClick={onSwitchPerspective}>
          切换视角 → {nextName}
        </button>
      )}
    </div>
  );
}
