// src/engine/atoms/询问闪.ts
// 询问闪:等待型 atom — 等待 target 出闪
import type { ActionPrompt, AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

const TIMEOUT_MS = 15_000;
const PROMPT: ActionPrompt = { type: 'useCard', title: '是否出闪', cardFilter: { filter: c => c.name === '闪', min: 1, max: 1 } };

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
    // 超时:不出闪,结算继续(父 action 检查处理区无闪牌则造成伤害)
    onTimeout: async () => {},
    prompt: PROMPT,
    timeout: 15,
  },
  effect: { sound: 'dodge_request', blockUntilDone: true, duration: 200 },
  toViewEvents(_state, atom): ViewEventSplit {
    // target 看到带 prompt 的询问，其他人只看到"某人被要求出闪"
    const targetView: ViewEvent = {
      type: '询问闪',
      target: atom.target,
      source: atom.source,
    };
    const othersView: ViewEvent = {
      type: '询问闪',
      target: atom.target,
      source: atom.source,
    };
    return {
      ownerViews: new Map([[atom.target, targetView]]),
      othersView,
    };
  },
  applyView(view, event) {
    const target = event.target as number;
    // target viewer: 完整 pending（可操作）
    if (view.viewer === target) {
      view.pending = {
        type: 'awaits',
        atom: { type: '询问闪', target, source: event.source } as unknown as import('../types').Atom,
        prompt: PROMPT,
        target,
        deadline: Date.now() + TIMEOUT_MS,
        totalMs: TIMEOUT_MS,
      };
    } else {
      // 其他 viewer:观察型 pending（不可操作,但 target 供视角自动跟随）
      view.pending = {
        type: 'awaits',
        atom: { type: '询问闪', target, source: event.source } as unknown as import('../types').Atom,
        prompt: { type: 'confirm', title: `等待出闪`, cancelLabel: '' },
        target,
        deadline: Date.now() + TIMEOUT_MS,
        totalMs: TIMEOUT_MS,
      };
    }
  },
};

registerAtom(询问闪);
