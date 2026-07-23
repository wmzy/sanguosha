// 无中生有 CardEffect — 普通锦囊·无中生有的使用结算。
//
// resolve: 询问无懈可击 →（若未被抵消）摸两张牌。
// target.kind='none': 对自己使用，无目标。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 无中生有的结算：摸牌(2) */
async function resolveExNihilo(ctx: ResolveCtx): Promise<void> {
  const { state, source } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理
  await applyAtom(state, { type: '摸牌', player: source, count: 2 });
}

const exNihiloEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'none' },
  resolve: resolveExNihilo,
  prompt: {
    type: 'useCard',
    title: '无中生有',
    cardFilter: { filter: (c: Card) => c.name === '无中生有', min: 1, max: 1 },
  } as ActionPrompt,
  label: '无中生有',
  style: 'primary',
};

registerCardEffect('无中生有', exNihiloEffect);
