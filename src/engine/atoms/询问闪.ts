// src/engine/atoms/询问闪.ts
// 询问闪:等待型 atom — 等待 target 出闪
import type { ActionPrompt, AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { resolveTimeoutMs } from '../create-engine';

const TIMEOUT_SEC = 15;
const PROMPT: ActionPrompt = {
  type: 'useCard',
  title: '是否出闪',
  cardFilter: { filter: (c) => c.name === '闪', min: 1, max: 1 },
};

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
    timeout: TIMEOUT_SEC,
  },
  effect: { sound: 'dodge_request', blockUntilDone: true, duration: 200 },
  toViewEvents(state, atom): ViewEventSplit {
    const timeoutMs = resolveTimeoutMs(state, TIMEOUT_SEC);
    const targetView: ViewEvent = {
      type: '询问闪',
      target: atom.target,
      source: atom.source,
      timeoutMs,
    };
    const othersView: ViewEvent = {
      type: '询问闪',
      target: atom.target,
      source: atom.source,
      timeoutMs,
    };
    return {
      ownerViews: new Map([[atom.target, targetView]]),
      othersView,
    };
  },
  applyView(view, event) {
    const target = event.target as number;
    const timeoutMs = (event.timeoutMs as number | undefined) ?? TIMEOUT_SEC * 1000;
    if (view.viewer === target) {
      view.pending = {
        type: 'awaits',
        atom: {
          type: '询问闪',
          target,
          source: event.source,
        } as unknown as import('../types').Atom,
        prompt: PROMPT,
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    } else {
      // 其他 viewer:观察型 pending（不可操作,但 target 供视角自动跟随）
      view.pending = {
        type: 'awaits',
        atom: {
          type: '询问闪',
          target,
          source: event.source,
        } as unknown as import('../types').Atom,
        prompt: { type: 'confirm', title: `等待出闪`, cancelLabel: '' },
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    }
  },
};

registerAtom(询问闪);
