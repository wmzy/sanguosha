// src/engine/atoms/询问闪.ts
// 询问闪:等待型 atom — 等待 target 出闪
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 询问闪: AtomDefinition<{ target: number; source: number }> = {
  type: '询问闪',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  pending: {
    onTimeout: { type: '无操作' },
    prompt: { type: 'useCard', title: '是否出闪', cardFilter: { filter: c => c.name === '闪', min: 1, max: 1 } },
    timeout: 15,
  },
  effect: { sound: 'dodge_request', blockUntilDone: true, duration: 200 },
  toViewEvents(_state, atom): ViewEventSplit {
    const effect = { sound: 'dodge_request' as const, blockUntilDone: true as const, duration: 200 };
    // target 看到带 prompt 的询问，其他人只看到"某人被要求出闪"
    const targetView: ViewEvent = {
      type: '询问闪',
      target: atom.target,
      source: atom.source,
      effect,
    };
    const othersView: ViewEvent = {
      type: '询问闪',
      target: atom.target,
      source: atom.source,
      effect: { duration: 200 },
    };
    return {
      ownerViews: new Map([[atom.target, targetView]]),
      othersView,
    };
  },
};

registerAtom(询问闪);
