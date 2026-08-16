// src/client/components/SeatArcLayout.tsx
// 弧形座位布局 — 从 GameView.tsx 抽出
//
// 职责:把 orderedPlayers.slice(1) 沿弧形排列,每个渲染一个 <PlayerSeatView>。
// 纯展示,所有数据和回调由 props 传入。底部可插入操作坞(prompt/倒计时/按钮)。
// 共享数据(view/perspectiveName)来自 GameViewCtx,专属数据仍走 props。

import type { ReactNode } from 'react';
import type { GameView } from '../../engine/types';
import * as styles from './gameViewStyles';
import { arcLayout } from '../utils/gameViewHelpers';
import { PlayerSeatView } from './PlayerSeatView';
import { CountdownBar } from './CountdownBar';
import { useGameView } from './GameViewCtx';
import type { HpChangeNumber } from '../hooks/useAnimationState';
import { DEFAULT_COUNTDOWN_TOTAL_MS } from '../hooks/useCountdown';

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
  /** 来自 useSeatOrder 的有序玩家列表(不含…… 实际仍含 self,内部 slice(1)) */
  orderedPlayers: GameView['players'];
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
  healFlashIndices: Map<number, number>;
  /** 体力变化漂浮数字(伤害 -N / 回血 +N),透传给座位卡 */
  hpChangeNumbers: Map<number, HpChangeNumber>;
  turnVersion: number;
  /** 游戏中已断线的座次集合(view player index),座位卡据此显示离线角标 */
  disconnectedSeats?: Set<number>;
  /** 翻牌动画期间隐藏座位倒计时:与 AwaitingPrompt 的 isPlayingFlipAnim 门控同步,
   *  避免牌还没翻完倒计时已扣掉 flip 时长(bar 与 prompt 不同步)。
   *  不伪造暂停——deadline 仍是服务端真实时钟,动画结束后恢复显示真实剩余。 */
  suppressCountdown?: boolean;
  /** 贴在座位区底部的操作坞(提示/倒计时/主按钮) */
  bottomSlot?: ReactNode;
}

export function SeatArcLayout(props: SeatArcLayoutProps) {
  // 共享数据来自 GameViewCtx(view/perspectiveName)
  const { view, perspectiveName } = useGameView();
  const {
    orderedPlayers,
    currentPlayerName,
    selectedNeedsTarget,
    selectedTargetNames,
    isTargetable,
    onTargetClick,
    onSeatDoubleClick,
    damageFlashIndices,
    healFlashIndices,
    hpChangeNumbers,
    turnVersion,
    disconnectedSeats,
    suppressCountdown,
    bottomSlot,
  } = props;

  return (
    <div className={styles.seatArcContainer}>
      {orderedPlayers.slice(1).length > 0 &&
        orderedPlayers.slice(1).map((player, i) => {
          const totalOthers = orderedPlayers.length - 1;
          const realIdx = view.players.findIndex((p) => p.name === player.name);
          const { leftPct, topPct } = arcLayout(totalOthers, i);
          // 门控集中在 deadline 派生这一处(渲染条件 seatDeadline !== null 不动),
          // 翻牌动画期间所有座位条统一隐藏,动画结束自动恢复为真实剩余时间。
          const seatDeadline = suppressCountdown ? null : deadlineForSeat(view, realIdx);
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
                isHealed={healFlashIndices.has(realIdx)}
                healVersion={healFlashIndices.get(realIdx) ?? 0}
                hpChange={hpChangeNumbers.get(realIdx)}
                isTurnGlow={player.name === currentPlayerName && turnVersion > 0}
                turnGlowVersion={turnVersion}
                isDisconnected={disconnectedSeats?.has(realIdx) ?? false}
              />
              {seatDeadline !== null && (
                <CountdownBar deadline={seatDeadline} totalMs={seatTotalMs} />
              )}
            </div>
          );
        })}
      {bottomSlot != null && <div className={styles.seatBottomDock}>{bottomSlot}</div>}
    </div>
  );
}
