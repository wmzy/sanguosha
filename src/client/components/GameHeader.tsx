// src/client/components/GameHeader.tsx
// 头部条:轮次徽章 + 阶段徽章 + 当前玩家 + (debug 模式)视角切换/跳转/自动跟随/退出按钮。
// 从 GameView.tsx 逐字迁移,纯展示组件。
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import { PHASE_LABELS } from './gameViewConstants';
import { DebugPerspectiveBar, type DebugPerspectiveBarProps } from './DebugPerspectiveBar';
import type { GameView } from '../../engine/types';

interface GameHeaderProps {
  view: GameView;
  /** 回合光环动画版本号 */
  animTurnVersion: number;
  /** 阶段动画版本号 */
  animPhaseVersion: number;
  currentPlayerName: string;
  perspectiveName: string;
  onSwitchPerspective?: () => void;
  onGoToCurrentPlayer?: () => void;
  autoSwitchCtl?: { enabled: boolean; toggle: () => void };
  onDeleteRoom?: () => void;
}

export function GameHeader({
  view,
  animTurnVersion,
  animPhaseVersion,
  currentPlayerName,
  perspectiveName,
  onSwitchPerspective,
  onGoToCurrentPlayer,
  autoSwitchCtl,
  onDeleteRoom,
}: GameHeaderProps) {
  const currentPlayer = view.players[view.currentPlayerIndex];

  return (
    <div className={styles.headerBar}>
      {onDeleteRoom && <button className={styles.backBtn} onClick={onDeleteRoom}>← 退出</button>}
      <div className={styles.headerCenter}>
        <span className={cx(styles.roundBadge, animTurnVersion > 0 && styles.turnGlowing)} key={`turn-${animTurnVersion}`}>第 {view.turn.round} 轮</span>
        <span className={cx(styles.phaseBadge, animPhaseVersion > 0 && styles.phaseAnimating)} key={`phase-${animPhaseVersion}`}>{PHASE_LABELS[view.phase] ?? view.phase}</span>
        <span className={styles.currentPlayerText}>
          当前: {currentPlayerName} {currentPlayer?.character ? `(${currentPlayer.character})` : ''}
        </span>
      </div>
      <DebugPerspectiveBar
        perspectiveName={perspectiveName}
        onSwitchPerspective={onSwitchPerspective}
        onGoToCurrentPlayer={onGoToCurrentPlayer}
        autoSwitchCtl={autoSwitchCtl}
      />
    </div>
  );
}