// 南蛮入侵 CardEffect — 普通锦囊·南蛮入侵的使用结算。
//
// resolve（逐目标）：询问无懈可击 → 询问杀 → 检查处理区 → 伤害。
// target.kind='allOthers': 所有其他角色（从下家开始按座次）。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 南蛮入侵的逐目标结算：询问杀 → 检查处理区 → 伤害 */
async function resolveBarbarianInvasion(ctx: ResolveCtx): Promise<void> {
  const { state, source, target, cardId } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理

  await applyAtom(state, { type: '询问杀', target, source });
  // 检查处理区：有杀牌 = 出了杀
  const killCardId = frameCards(state).find((id) => state.cardMap[id]?.name === '杀');
  if (killCardId) {
    // 出了杀：移到弃牌堆
    await applyAtom(state, {
      type: '移动牌',
      cardId: killCardId,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });
  } else {
    // 没出杀：受伤害
    if (!state.players[target]?.alive) return;
    await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId });
  }
}

const barbarianInvasionEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'allOthers' },
  resolve: resolveBarbarianInvasion,
  prompt: {
    type: 'useCard',
    title: '南蛮入侵',
    cardFilter: { filter: (c: Card) => c.name === '南蛮入侵', min: 1, max: 1 },
  } as ActionPrompt,
  label: '南蛮入侵',
  style: 'danger',
};

registerCardEffect('南蛮入侵', barbarianInvasionEffect);
