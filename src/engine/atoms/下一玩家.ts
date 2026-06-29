// src/engine/atoms/下一玩家.ts
// 下一玩家:currentPlayerIndex 移到下一个存活玩家
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

/** 计算下一个存活玩家的索引(apply 和 toViewEvents 共用) */
function calcNextPlayer(state: { players: { alive: boolean }[]; currentPlayerIndex: number }): {
  nextIdx: number;
  roundIncrement: boolean;
} {
  const n = state.players.length;
  if (n === 0) return { nextIdx: 0, roundIncrement: false };
  const prev = state.currentPlayerIndex;
  let nextIdx = (prev + 1) % n;
  let safety = n;
  while (!state.players[nextIdx].alive && safety > 0) {
    nextIdx = (nextIdx + 1) % n;
    safety--;
  }
  return { nextIdx, roundIncrement: nextIdx <= prev };
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
    const { nextIdx } = calcNextPlayer(state);
    const view: ViewEvent = { type: '下一玩家', newPlayer: nextIdx };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view: GameView, event) {
    view.currentPlayerIndex = event.newPlayer as number;
  },
  toViewLog() {
    return null; // 下一玩家不产生日志
  },
};

registerAtom(下一玩家);
