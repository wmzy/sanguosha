// src/engine/atoms/询问杀.ts
// 询问杀:等待型 atom — 等待 target 出杀
import type { ActionPrompt, AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { resolveTimeoutMs } from '../create-engine';

const TIMEOUT_SEC = 15;
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
    // 超时:不出杀,结算继续
    onTimeout: async () => {},
    prompt: PROMPT,
    timeout: TIMEOUT_SEC,
  },
  effect: { sound: 'slash_request', blockUntilDone: true, duration: 200 },
  toViewEvents(state, atom): ViewEventSplit {
    // 应用房间 timeoutScale;透传给 applyView,使前端倒计时与后端真实定时器一致
    const timeoutMs = resolveTimeoutMs(state, TIMEOUT_SEC);
    const targetView: ViewEvent = {
      type: '询问杀',
      target: atom.target,
      source: atom.source,
      timeoutMs,
    };
    const othersView: ViewEvent = {
      type: '询问杀',
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
        atom: { type: '询问杀', target, source: event.source } as unknown as import('../types').Atom,
        prompt: PROMPT,
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    } else {
      view.pending = {
        type: 'awaits',
        atom: { type: '询问杀', target, source: event.source } as unknown as import('../types').Atom,
        prompt: { type: 'confirm', title: `等待出杀`, cancelLabel: '' },
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    }
  },
};

registerAtom(询问杀);
