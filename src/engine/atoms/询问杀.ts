// src/engine/atoms/询问杀.ts
// 询问杀:等待型 atom — 等待 target 出杀
import type { ActionPrompt, AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../core/atom';
import { resolveTimeoutMs } from '../core/timeout';
import {
  SHORT_DELAY_MS,
  SILENT_RESPONSE_PROMPT,
  cardResponsePreResolveForTarget,
  evaluateCardResponseModeForTarget,
} from '../core/card-response-availability';

const TIMEOUT_SEC = 15;
const PROMPT: ActionPrompt = {
  type: 'useCard',
  title: '是否出杀',
  cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
};

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
    // 卡牌回应型预检:无手牌→skip;有手牌无杀→silent;有杀→正常。
    // 若 target 有转化/转交防御技(龙胆/激将 等)→ 正常询问。
    preResolve: (state, atom) =>
      cardResponsePreResolveForTarget(state, '询问杀', atom.target, (c) => c.name === '杀'),
  },
  effect: { blockUntilDone: true, duration: 200 },
  toViewEvents(state, atom): ViewEventSplit {
    const mode = evaluateCardResponseModeForTarget(state, '询问杀', atom.target, (c) => c.name === '杀');
    const timeoutMs =
      mode === 'silent' ? SHORT_DELAY_MS : resolveTimeoutMs(state, TIMEOUT_SEC);
    const base: ViewEvent = {
      type: '询问杀',
      target: atom.target,
      source: atom.source,
      timeoutMs,
      responseMode: mode,
    };
    return {
      ownerViews: new Map([[atom.target, base]]),
      othersView: base,
    };
  },
  applyView(view, event) {
    const target = event.target as number;
    const mode = (event.responseMode as 'normal' | 'silent' | 'skip' | undefined) ?? 'normal';
    if (mode === 'skip') return;
    const timeoutMs = (event.timeoutMs as number | undefined) ?? TIMEOUT_SEC * 1000;
    const atomObj = {
      type: '询问杀',
      target,
      source: event.source,
    } as unknown as import('../types').Atom;
    if (mode === 'silent') {
      view.pending = {
        type: 'awaits',
        atom: atomObj,
        prompt: SILENT_RESPONSE_PROMPT,
        target,
        responseMode: 'silent',
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
      return;
    }
    if (view.viewer === target) {
      view.pending = {
        type: 'awaits',
        atom: atomObj,
        prompt: PROMPT,
        target,
        responseMode: 'normal',
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    } else {
      view.pending = {
        type: 'awaits',
        atom: atomObj,
        prompt: { type: 'confirm', title: `等待出杀`, cancelLabel: '' },
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    }
  },
};

registerAtom(询问杀);
