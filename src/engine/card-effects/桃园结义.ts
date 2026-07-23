// 桃园结义 CardEffect — 普通锦囊·桃园结义的使用结算。
//
// resolve（逐目标）：满血跳过 → 询问无懈可击 → 回复 1 点体力。
// target.kind='allPlayers': 所有存活角色（含使用者）。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 桃园结义的逐目标结算：满血跳过 → 回复体力 */
async function resolvePeachGarden(ctx: ResolveCtx): Promise<void> {
  const { state, target } = ctx;
  const p = state.players[target];
  if (!p?.alive) return;
  // 满血目标：桃园结义对其无效果，不回血
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理
  if (p.health >= p.maxHealth) return;

  await applyAtom(state, { type: '回复体力', target, amount: 1 });
}

const peachGardenEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'allPlayers' },
  /** 满血目标无回血效果 → 不询问无懈、不结算 */
  hasEffect: (state, target) => {
    const p = state.players[target];
    return !!p?.alive && p.health < p.maxHealth;
  },
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
