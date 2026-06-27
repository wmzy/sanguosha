// src/client/components/SeatArcLayout.tsx
// 弧形座位布局 — 从 GameView.tsx 抽出
//
// 职责:把 orderedPlayers.slice(1) 沿弧形排列,每个渲染一个 <PlayerSeatView>。
// 纯展示,所有数据和回调由 props 传入。

import type { GameView } from '../../engine/types';
import * as styles from './gameViewStyles';
import { arcLayout } from '../utils/gameViewHelpers';
import { PlayerSeatView } from './PlayerSeatView';
import { CountdownBar, DEFAULT_COUNTDOWN_TOTAL_MS } from './CountdownBar';

/** 计算指定座次的倒计时 deadline。
 *  - pending 精准命中该座次(target === idx)→ pending.deadline
 *  - 广播型 pending(target < 0,如无懈可击)→ 所有活玩家的座次都共享此 deadline
 *  - 否则 → null(该座次不在等待) */
function deadlineForSeat(view: GameView, idx: number): number | null {
  const pending = view.pending;
  if (!pending) return null;
  if (pending.target < 0) {
    // 广播型:活玩家共享
    return view.players[idx]?.alive ? (pending.deadline ?? null) : null;
  }
  return pending.target === idx ? (pending.deadline ?? null) : null;
}

export interface SeatArcLayoutProps {
  view: GameView;
  /** 来自 useSeatOrder 的有序玩家列表(不含…… 实际仍含 self,内部 slice(1)) */
  orderedPlayers: GameView['players'];
  perspectiveName: string;
  currentPlayerName: string;
  /** 目标选择相关(透传给 PlayerSeatView) */
  selectedNeedsTarget: boolean;
  /** 已选中目标 name 集合(透传给座位高亮;双目标含 A+B) */
  selectedTargetNames: string[];
  /** 父组件传入的距离检查函数 */
  isTargetable: (idx: number) => boolean;
  onTargetClick: (name: string) => void;
  /** 双击座次卡片(透传给 PlayerSeatView)。 */
  onSeatDoubleClick?: (index: number) => void;
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
    selectedTargetNames,
    isTargetable,
    onTargetClick,
    onSeatDoubleClick,
    damageFlashIndices,
    turnVersion,
  } = props;

  return (
    <div className={styles.seatArcContainer}>
      {orderedPlayers.slice(1).length > 0 &&
        orderedPlayers.slice(1).map((player, i) => {
          const totalOthers = orderedPlayers.length - 1;
          const realIdx = view.players.findIndex((p) => p.name === player.name);
          // 沿 180° 弧形分布: 左端5% 右端95%, Y轴弧线中间高两端低
          const { leftPct, topPct } = arcLayout(totalOthers, i);
          const seatDeadline = deadlineForSeat(view, realIdx);
          const seatTotalMs = view.pending?.totalMs ?? DEFAULT_COUNTDOWN_TOTAL_MS;
          return (
            <div
              key={player.name}
              className={styles.seatArcSlot}
              style={
                { '--seat-left': `${leftPct}%`, '--seat-top': `${topPct}%` } as React.CSSProperties
              }
            >
              <PlayerSeatView
                player={player}
                index={realIdx}
                view={view}
                isCurrentPlayer={player.name === currentPlayerName}
                isPerspective={player.name === perspectiveName}
                needsTarget={selectedNeedsTarget}
                isTargetable={isTargetable(realIdx)}
                selectedTargetNames={selectedTargetNames}
                onTargetClick={onTargetClick}
                onSeatDoubleClick={onSeatDoubleClick}
                isDamaged={damageFlashIndices.has(realIdx)}
                damageVersion={damageFlashIndices.get(realIdx) ?? 0}
                isTurnGlow={player.name === currentPlayerName && turnVersion > 0}
                turnGlowVersion={turnVersion}
              />
              {/* 其他角色等待进度条:仅当该座次正在等待回应时显示 */}
              {seatDeadline !== null && (
                <CountdownBar deadline={seatDeadline} totalMs={seatTotalMs} />
              )}
            </div>
          );
        })}
    </div>
  );
}
