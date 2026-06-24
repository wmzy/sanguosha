// src/client/components/DebugPerspectiveBar.tsx
// debug 模式视角控制栏:视角切换 / 跳转当前玩家 / 自动跟随开关 / 退出房间。
// 由上层(DebugLobby)渲染到 GameViewComponent 的 headerSlot / overlaySlot,
// GameViewComponent 本身不感知视角切换。
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';

export interface DebugPerspectiveBarProps {
  perspectiveName: string;
  onSwitchPerspective?: () => void;
  /** 切到下一个未选将座次(选将阶段专用)。 */
  onSwitchToNextUnselected?: () => void;
  onGoToCurrentPlayer?: () => void;
  autoSwitchCtl?: { enabled: boolean; toggle: () => void };
  /** 退出/删除房间(可选;渲染「退出」按钮)。 */
  onDeleteRoom?: () => void;
}

export function DebugPerspectiveBar({
  perspectiveName,
  onSwitchPerspective,
  onSwitchToNextUnselected,
  onGoToCurrentPlayer,
  autoSwitchCtl,
  onDeleteRoom,
}: DebugPerspectiveBarProps) {
  if (!onSwitchPerspective && !onDeleteRoom && !onSwitchToNextUnselected) return null;
  return (
    <div className={styles.headerRight}>
      {onDeleteRoom && <button className={styles.backBtn} onClick={onDeleteRoom}>← 退出</button>}
      {onSwitchToNextUnselected && (
        <button className={styles.goToBtn} onClick={onSwitchToNextUnselected}>下一个待选者</button>
      )}
      {onSwitchPerspective && (
        <button className={styles.perspectiveBtn} onClick={onSwitchPerspective}>
          视角: {perspectiveName}
        </button>
      )}
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
