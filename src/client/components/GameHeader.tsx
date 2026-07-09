// src/client/components/GameHeader.tsx
// 头部条:轮次徽章 + 阶段徽章 + 当前玩家。
// 纯展示组件,不含任何视角切换逻辑。
// 右侧由上层通过 headerSlot 注入(视角控制/退出按钮等 debug UI)。
import { memo, type ReactNode } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import { PHASE_LABELS } from './gameViewConstants';
import type { GameView } from '../../engine/types';

interface GameHeaderProps {
  view: GameView;
  /** 回合光环动画版本号 */
  animTurnVersion: number;
  /** 阶段动画版本号 */
  animPhaseVersion: number;
  currentPlayerName: string;
  /** 右侧插槽:上层渲染视角控制/退出等 debug UI。 */
  headerSlot?: ReactNode;
}

function GameHeaderImpl({
  view,
  animTurnVersion,
  animPhaseVersion,
  currentPlayerName,
  headerSlot,
}: GameHeaderProps) {
  const currentPlayer = view.players[view.currentPlayerIndex];

  return (
    <div className={styles.headerBar}>
      <div className={styles.headerCenter}>
        <span
          className={cx(styles.roundBadge, animTurnVersion > 0 && styles.turnGlowing)}
          key={`turn-${animTurnVersion}`}
        >
          第 {view.turn.round} 轮
        </span>
        <span
          className={cx(styles.phaseBadge, animPhaseVersion > 0 && styles.phaseAnimating)}
          key={`phase-${animPhaseVersion}`}
        >
          {PHASE_LABELS[view.phase] ?? view.phase}
        </span>
        <span className={styles.currentPlayerText}>
          当前: {currentPlayerName} {currentPlayer.character ? `(${currentPlayer.character})` : ''}
        </span>
      </div>
      {headerSlot}
    </div>
  );
}

/** memo: 头部只在轮次/阶段/当前玩家/动画版本/插槽变化时重渲染 */
function gameHeaderPropsEqual(prev: GameHeaderProps, next: GameHeaderProps): boolean {
  return (
    prev.view.turn.round === next.view.turn.round &&
    prev.view.phase === next.view.phase &&
    prev.view.players[prev.view.currentPlayerIndex]?.character ===
      next.view.players[next.view.currentPlayerIndex]?.character &&
    prev.animTurnVersion === next.animTurnVersion &&
    prev.animPhaseVersion === next.animPhaseVersion &&
    prev.currentPlayerName === next.currentPlayerName &&
    prev.headerSlot === next.headerSlot
  );
}

export const GameHeader = memo(GameHeaderImpl, gameHeaderPropsEqual);
