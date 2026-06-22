// src/engine/atoms/询问杀.ts
// 询问杀:等待型 atom — 等待 target 出杀
import type { ActionPrompt, AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

const TIMEOUT_MS = 15_000;
const PROMPT: ActionPrompt = { type: 'useCard', title: '是否出杀', cardFilter: { filter: c => c.name === '杀', min: 1, max: 1 } };

export const 询问杀: AtomDefinition<{ target: number; source: number }> = {
  type: '询问杀',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  pending: {
    onTimeout: { type: '无操作' },
    prompt: PROMPT,
    timeout: 15,
  },
  effect: { sound: 'slash_request', blockUntilDone: true, duration: 200 },
  toViewEvents(_state, atom): ViewEventSplit {
    const effect = { sound: 'slash_request' as const, blockUntilDone: true as const, duration: 200 };
    const targetView: ViewEvent = {
      type: '询问杀',
      target: atom.target,
      source: atom.source,
      effect,
    };
    const othersView: ViewEvent = {
      type: '询问杀',
      target: atom.target,
      source: atom.source,
      effect: { duration: 200 },
    };
    return {
      ownerViews: new Map([[atom.target, targetView]]),
      othersView,
    };
  },
  applyView(view, event) {
    // 只有被问询的玩家才设置 pending
    if (view.viewer === event.target) {
      view.pending = {
        type: 'awaits',
        atom: { type: '询问杀', target: event.target, source: event.source } as unknown as import('../types').Atom,
        prompt: PROMPT,
        target: event.target,
        deadline: Date.now() + TIMEOUT_MS,
        totalMs: TIMEOUT_MS,
      };
    }
  },
};

registerAtom(询问杀);
