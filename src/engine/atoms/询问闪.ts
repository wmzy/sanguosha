// src/engine/atoms/询问闪.ts
// 询问闪:等待型 atom — 等待 target 出闪
import type { ActionPrompt, AtomDefinition, ViewEventSplit } from '../types';
import { broadcast } from './_helpers';
import { cardResponsePreResolveForTarget } from '../core/card-response-availability';

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
    // 卡牌回应型预检:无手牌→skip(立即,无延时);有手牌无闪→silent(短延时,不被询问);有闪→正常。
    // 若 target 有转化/转交防御技(龙胆/倾国/护驾 等)→ 正常询问(不剥夺技能)。
    preResolve: (state, atom) =>
      cardResponsePreResolveForTarget(state, '询问闪', atom.target, (c) => c.name === '闪'),
  },
  effect: { blockUntilDone: true, duration: 200 },
  // Interactive state is published from the actual slot, never reconstructed by the client clock.
  toViewEvents(_state, atom): ViewEventSplit {
    return broadcast({ type: '询问闪', target: atom.target, source: atom.source });
  },
};
