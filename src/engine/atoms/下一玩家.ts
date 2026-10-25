// src/engine/atoms/下一玩家.ts
// 下一玩家:currentPlayerIndex 移到逆时针下一位存活玩家。
// 座次约定:索引递增 = 顺时针,出牌方向 = 逆时针(索引递减)。
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';

/** 计算下一个存活玩家的索引(apply 和 toViewEvents 共用) */
function calcNextPlayer(state: { players: { alive: boolean }[]; currentPlayerIndex: number }): {
  nextIdx: number;
  roundIncrement: boolean;
} {
  const n = state.players.length;
  if (n === 0) return { nextIdx: 0, roundIncrement: false };
  const prev = state.currentPlayerIndex;
  // 逆时针 = 索引递减;跳过死亡玩家时继续递减。
  let nextIdx = (prev - 1 + n) % n;
  let safety = n;
  while (!state.players[nextIdx].alive && safety > 0) {
    nextIdx = (nextIdx - 1 + n) % n;
    safety--;
  }
  // 递减越过 0 → 回到 n-1,即完成一圈。
  return { nextIdx, roundIncrement: nextIdx >= prev };
}

export const 下一玩家: AtomDefinition<Record<string, never>> = {
  type: '下一玩家',
  validate() {
    return null;
  },
  apply(state) {
    const { nextIdx, roundIncrement } = calcNextPlayer(state);
    if (roundIncrement) state.turn.round += 1;
    state.currentPlayerIndex = nextIdx;
  },
  toViewEvents(state, _atom): ViewEventSplit {
    const { nextIdx, roundIncrement } = calcNextPlayer(state);
    // toViewEvents 在 apply 之前调用,故 round 需按 apply 的递增规则预计算。
    // round 一并下发:回合递增发生在「下一玩家」apply,若只由后续「回合开始」事件投影,
    // 放权/额外回合 cancel 回合结束等路径会让增量视图暂时落后于 buildView。
    const view: ViewEvent = {
      type: '下一玩家',
      newPlayer: nextIdx,
      round: state.turn.round + (roundIncrement ? 1 : 0),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view: GameView, event) {
    view.currentPlayerIndex = event.newPlayer as number;
    if (typeof event.round === 'number') view.turn.round = event.round;
  },
  toViewLog() {
    return null; // 下一玩家不产生日志
  },
};

