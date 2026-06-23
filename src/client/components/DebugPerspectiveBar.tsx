// src/client/components/DebugPerspectiveBar.tsx
// debug 模式视角控制栏:视角切换 / 跳转当前玩家 / 自动跟随开关。
// 提取自 GameHeader,供 GameHeader 和 CharSelectOverlay 复用,保证两处一致。
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';

export interface DebugPerspectiveBarProps {
  perspectiveName: string;
  onSwitchPerspective?: () => void;
  onGoToCurrentPlayer?: () => void;
  autoSwitchCtl?: { enabled: boolean; toggle: () => void };
}

export function DebugPerspectiveBar({
  perspectiveName,
  onSwitchPerspective,
  onGoToCurrentPlayer,
  autoSwitchCtl,
}: DebugPerspectiveBarProps) {
  if (!onSwitchPerspective) return null;
  return (
    <div className={styles.headerRight}>
      <button className={styles.perspectiveBtn} onClick={onSwitchPerspective}>
        视角: {perspectiveName}
      </button>
      {onGoToCurrentPlayer && <button className={styles.goToBtn} onClick={onGoToCurrentPlayer}>查看当前玩家</button>}
      {autoSwitchCtl && (
        <button
          className={cx(styles.goToBtn, autoSwitchCtl.enabled && styles.autoSwitchActive)}
          onClick={autoSwitchCtl.toggle}
        >
          自动切换{autoSwitchCtl.enabled ? '✓' : '✗'}
        </button>
      )}
    </div>
  );
}
