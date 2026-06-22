// src/engine/atoms/下一玩家.ts
// 下一玩家:currentPlayerIndex 移到下一个存活玩家
import type { AtomDefinition, GameView } from '../types';
import { registerAtom } from '../atom';

export const 下一玩家: AtomDefinition<Record<string, never>> = {
  type: '下一玩家',
  validate() { return null; },
  apply(state) {
    if (state.players.length === 0) return;
    const prev = state.currentPlayerIndex;
    let nextIdx = (prev + 1) % state.players.length;
    let safety = state.players.length;
    while (!state.players[nextIdx].alive && safety > 0) {
      nextIdx = (nextIdx + 1) % state.players.length;
      safety--;
    }
    // 绕回起点 → 回合数 +1
    if (nextIdx <= prev) {
      state.turn.round += 1;
    }
    state.currentPlayerIndex = nextIdx;
  },
  applyView(view: GameView) {
    // 复用 apply 的下一存活玩家计算逻辑(atom 无字段,event 不携带 nextIndex)
    if (view.players.length === 0) return;
    const prev = view.currentPlayerIndex;
    let nextIdx = (prev + 1) % view.players.length;
    let safety = view.players.length;
    while (!view.players[nextIdx].alive && safety > 0) {
      nextIdx = (nextIdx + 1) % view.players.length;
      safety--;
    }
    if (nextIdx <= prev) {
      view.turn.round += 1;
    }
    view.currentPlayerIndex = nextIdx;
  },
};

registerAtom(下一玩家);
