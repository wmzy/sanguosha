// src/engine/atoms/询问杀.ts
// 询问杀:等待型 atom — 等待 target 出杀
import type { ActionPrompt, AtomDefinition, ViewEventSplit } from '../types';
import { broadcast } from './_helpers';
import { cardResponsePreResolveForTarget } from '../core/card-response-availability';

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
  // Interactive state is published from the actual slot, never reconstructed by the client clock.
  toViewEvents(_state, atom): ViewEventSplit {
    return broadcast({ type: '询问杀', target: atom.target, source: atom.source });
  },
};
