// src/client/components/SeatArcLayout.tsx
// 弧形座位布局 — 从 GameView.tsx 抽出
//
// 职责:把 orderedPlayers.slice(1) 沿弧形排列,每个渲染一个 <PlayerSeatView>。
// 纯展示,所有数据和回调由 props 传入。

import type { GameView } from '../../engine/types';
import * as styles from './gameViewStyles';
import { arcLayout } from '../utils/gameViewHelpers';
import { PlayerSeatView } from './PlayerSeatView';

export interface SeatArcLayoutProps {
  view: GameView;
  /** 来自 useSeatOrder 的有序玩家列表(不含…… 实际仍含 self,内部 slice(1)) */
  orderedPlayers: GameView['players'];
  perspectiveName: string;
  currentPlayerName: string;
  /** 目标选择相关(透传给 PlayerSeatView) */
  selectedNeedsTarget: boolean;
  selectedTarget: string | null;
  /** 父组件传入的距离检查函数 */
  isTargetable: (idx: number) => boolean;
  onTargetClick: (name: string) => void;
  onPerspectiveChange?: (idx: number) => void;
  /** 动画 */
  damageFlashIndices: Map<number, number>;
  turnVersion: number;
}

export function SeatArcLayout(props: SeatArcLayoutProps) {
  const {
    view,
    orderedPlayers,
    perspectiveName,
    currentPlayerName,
    selectedNeedsTarget,
    selectedTarget,
    isTargetable,
    onTargetClick,
    onPerspectiveChange,
    damageFlashIndices,
    turnVersion,
  } = props;

  return (
    <div className={styles.seatArcContainer}>
      {orderedPlayers.slice(1).length > 0 && orderedPlayers.slice(1).map((player, i) => {
        const totalOthers = orderedPlayers.length - 1;
        const realIdx = view.players.findIndex(p => p.name === player.name);
        // 沿 180° 弧形分布: 左端5% 右端95%, Y轴弧线中间高两端低
        const { leftPct, topPct } = arcLayout(totalOthers, i);
        return (
          <div
            key={player.name}
            className={styles.seatArcSlot}
            style={{ left: `${leftPct}%`, top: `${topPct}%` }}
          >
            <PlayerSeatView
              player={player}
              index={realIdx}
              view={view}
              isCurrentPlayer={player.name === currentPlayerName}
              isPerspective={player.name === perspectiveName}
              needsTarget={selectedNeedsTarget}
              isTargetable={isTargetable(realIdx)}
              selectedTarget={selectedTarget}
              onTargetClick={onTargetClick}
              onPerspectiveChange={(idx) => { onPerspectiveChange?.(idx); }}
              isDamaged={damageFlashIndices.has(realIdx)}
              damageVersion={damageFlashIndices.get(realIdx) ?? 0}
              isTurnGlow={player.name === currentPlayerName && turnVersion > 0}
              turnGlowVersion={turnVersion}
            />
          </div>
        );
      })}
    </div>
  );
}