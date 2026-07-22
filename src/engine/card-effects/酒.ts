// 酒 CardEffect — 基本牌·酒的使用结算。
//
// resolve: 加标记（本回合下一张杀伤害+1）。
// target.kind='self': 对自己使用。
// 酒的 respond（濒死当桃）保留在 skills/酒.ts。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 酒的结算：加增伤标记 */
async function resolveWine(ctx: ResolveCtx): Promise<void> {
  const { state, source } = ctx;
  await applyAtom(state, {
    type: '加标记',
    player: source,
    mark: { id: '酒/nextKillDamageBonus', scope: -1, payload: 1, duration: 'turn' },
  });
}

const wineEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'self' },
  resolve: resolveWine,
  prompt: {
    type: 'useCard',
    title: '饮酒',
    cardFilter: { filter: (c: Card) => c.name === '酒', min: 1, max: 1 },
  } as ActionPrompt,
  label: '酒',
  style: 'default',
  activeWhen: (ctx) => defaultPlayActive(ctx),
};

registerCardEffect('酒', wineEffect);
