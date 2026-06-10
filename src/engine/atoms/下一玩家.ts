// src/engine/atoms/下一玩家.ts
// 下一玩家:currentPlayerIndex 移到下一个存活玩家
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 下一玩家: AtomDefinition<Record<string, never>> = {
  type: '下一玩家',
  validate() { return null; },
  apply(state) {
    if (state.players.length === 0) return state;
    let nextIdx = (state.currentPlayerIndex + 1) % state.players.length;
    let safety = state.players.length;
    while (!state.players[nextIdx].alive && safety > 0) {
      nextIdx = (nextIdx + 1) % state.players.length;
      safety--;
    }
    return { ...state, currentPlayerIndex: nextIdx };
  },
};

registerAtom(下一玩家);
