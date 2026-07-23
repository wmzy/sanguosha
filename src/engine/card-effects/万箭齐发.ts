// 万箭齐发 CardEffect — 普通锦囊·万箭齐发的使用结算。
//
// resolve（逐目标）：询问无懈可击 → 询问闪 → 检查处理区 → 伤害/抵消。
// target.kind='allOthers': 所有其他角色（从下家开始按座次）。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 万箭齐发的逐目标结算：询问闪 → 检查处理区 → 伤害/抵消 */
async function resolveArrowVolley(ctx: ResolveCtx): Promise<void> {
  const { state, source, target, cardId } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理，此处不再询问

  await applyAtom(state, { type: '询问闪', target, source });
  // 检查处理区：有闪牌 = 出了闪
  const dodgeCardId = frameCards(state).find((id) => state.cardMap[id]?.name === '闪');
  if (dodgeCardId) {
    // 出了闪 → 被抵消
    await applyAtom(state, { type: '被抵消', source, target, cardId });
    // 移走闪到弃牌堆
    await applyAtom(state, {
      type: '移动牌',
      cardId: dodgeCardId,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });
  } else {
    // 没闪：受伤害
    if (!state.players[target]?.alive) return;
    await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId });
  }
}

const arrowVolleyEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'allOthers' },
  resolve: resolveArrowVolley,
  prompt: {
    type: 'useCard',
    title: '万箭齐发',
    cardFilter: { filter: (c: Card) => c.name === '万箭齐发', min: 1, max: 1 },
  } as ActionPrompt,
  label: '万箭齐发',
  style: 'danger',
};

registerCardEffect('万箭齐发', arrowVolleyEffect);
