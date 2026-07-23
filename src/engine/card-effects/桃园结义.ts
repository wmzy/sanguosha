// 桃园结义 CardEffect — 普通锦囊·桃园结义的使用结算。
//
// resolve（逐目标）：满血跳过 → 询问无懈可击 → 回复 1 点体力。
// target.kind='allPlayers': 所有存活角色（含使用者）。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { 询问无懈可击 } from '../无懈可击';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 桃园结义的逐目标结算：满血跳过 → 无懈 → 回复体力 */
async function resolvePeachGarden(ctx: ResolveCtx): Promise<void> {
  const { state, target } = ctx;
  const p = state.players[target];
  if (!p?.alive) return;
  // 满血目标：桃园结义对其无效果（无可抵消的效果），不询问无懈也不回血
  if (p.health >= p.maxHealth) return;

  const cancelled = await 询问无懈可击(state, target);
  if (cancelled) return;

  await applyAtom(state, { type: '回复体力', target, amount: 1 });
}

const peachGardenEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'allPlayers' },
  resolve: resolvePeachGarden,
  prompt: {
    type: 'useCard',
    title: '桃园结义',
    cardFilter: { filter: (c: Card) => c.name === '桃园结义', min: 1, max: 1 },
  } as ActionPrompt,
  label: '桃园结义',
  style: 'primary',
};

registerCardEffect('桃园结义', peachGardenEffect);
