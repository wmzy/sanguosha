// src/engine/atoms/陷入濒死.ts
// 陷入濒死:标记目标进入濒死状态(体力 ≤ 0,等待求桃)。纯事件标记——不修改 state。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 陷入濒死: AtomDefinition<{ target: number }> = {
  type: '陷入濒死',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply() {
    // 纯事件标记——体力扣减由 造成伤害/失去体力 负责,alive 由 击杀 负责
  },
  effect: { sound: 'dying', animation: 'flash_red', duration: 600 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '陷入濒死',
      target: atom.target,
      effect: { sound: 'dying', animation: 'flash_red', duration: 600 },
    };
    return { ownerViews: new Map(), othersView: view };
  },
};

registerAtom(陷入濒死);
