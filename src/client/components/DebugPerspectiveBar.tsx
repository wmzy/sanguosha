// src/client/components/DebugPerspectiveBar.tsx
// debug 模式视角控制栏:视角切换 / 跳转当前玩家 / 自动跟随开关 / 退出房间 / 保存快照。
// 由上层(DebugLobby)渲染到 GameViewComponent 的 headerSlot / overlaySlot,
// GameViewComponent 本身不感知视角切换。
import { useState, useCallback } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import { copyToClipboard } from '../utils/clipboard';

export interface DebugPerspectiveBarProps {
  perspectiveName: string;
  onSwitchPerspective?: () => void;
  /** 切到下一个未选将座次(选将阶段专用)。 */
  onSwitchToNextUnselected?: () => void;
  onGoToCurrentPlayer?: () => void;
  autoSwitchCtl?: { enabled: boolean; toggle: () => void };
  /** 退出/删除房间(可选;渲染「退出」按钮)。 */
  onDeleteRoom?: () => void;
  /** 保存快照(可选;渲染「保存快照」按钮)。 */
  onSaveSnapshot?: () => void;
  snapshotSaving?: boolean;
  /** toast 文案(如「已保存: data/snapshots/xxx/」) */
  snapshotToast?: string | null;
  /** 快照目录路径(传给复制按钮;为 null 时不渲染复制按钮) */
  snapshotPath?: string | null;
  snapshotError?: string | null;
}

export function DebugPerspectiveBar({
  perspectiveName,
  onSwitchPerspective,
  onSwitchToNextUnselected,
  onGoToCurrentPlayer,
  autoSwitchCtl,
  onDeleteRoom,
  onSaveSnapshot,
  snapshotSaving,
  snapshotToast,
  snapshotPath,
  snapshotError,
}: DebugPerspectiveBarProps) {
  // 复制反馈:点击后短暂显示「已复制」,2 秒后恢复
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (!snapshotPath) return;
    const ok = await copyToClipboard(snapshotPath);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    // fallback 也失败时静默:此时无可靠手段,不弹错打扰用户
  }, [snapshotPath]);
  if (!onSwitchPerspective && !onDeleteRoom && !onSwitchToNextUnselected && !onSaveSnapshot)
    return null;
  return (
    <div className={styles.headerRight}>
      {onDeleteRoom && (
        <button className={styles.backBtn} onClick={onDeleteRoom}>
          ← 退出
        </button>
      )}
      {onSwitchToNextUnselected && (
        <button className={styles.goToBtn} onClick={onSwitchToNextUnselected}>
          下一个待选者
        </button>
      )}
      {onSwitchPerspective && (
        <button className={styles.perspectiveBtn} onClick={onSwitchPerspective}>
          视角: {perspectiveName}
        </button>
      )}
      {onGoToCurrentPlayer && (
        <button className={styles.goToBtn} onClick={onGoToCurrentPlayer}>
          查看当前玩家
        </button>
      )}
      {autoSwitchCtl && (
        <button
          className={cx(styles.goToBtn, autoSwitchCtl.enabled && styles.autoSwitchActive)}
          onClick={autoSwitchCtl.toggle}
        >
          自动切换{autoSwitchCtl.enabled ? '✓' : '✗'}
        </button>
      )}
      {onSaveSnapshot && (
        <button className={styles.snapshotBtn} onClick={onSaveSnapshot} disabled={snapshotSaving}>
          {snapshotSaving ? '保存中…' : '保存快照'}
        </button>
      )}
      {snapshotError ? (
        <div className={styles.snapshotErrorToast}>{snapshotError}</div>
      ) : (
        snapshotToast && (
          <div className={styles.snapshotToast}>
            {snapshotToast}
            {snapshotPath && (
              <button
                className={cx(styles.copyBtn, copied && styles.copyBtnDone)}
                onClick={handleCopy}
              >
                {copied ? '✓ 已复制' : '复制'}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
