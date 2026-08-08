// 无中生有 CardEffect — 普通锦囊·无中生有的使用结算。
//
// resolve: 目标角色摸两张牌（无懈可击由 runSettlementPhase 的「生效前」时机统一处理）。
// target.kind='any': 包括使用者在内的一名角色（界限突破/1V1/国-标 语义）。

import type { Card } from '../types';
import { applyAtom } from '../core/apply';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../core/card-effect/registry';

/** 无中生有的结算：目标角色摸牌(2) */
async function resolveExNihilo(ctx: ResolveCtx): Promise<void> {
  const { state, target } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理
  await applyAtom(state, { type: '摸牌', player: target, count: 2 });
}

const exNihiloEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'any', min: 1, max: 1 },
  resolve: resolveExNihilo,
  prompt: {
    type: 'useCardAndTarget',
    title: '无中生有',
    cardFilter: { filter: (c: Card) => c.name === '无中生有', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1, allowSelf: true },
  },
  label: '无中生有',
  style: 'primary',
};

registerCardEffect('无中生有', exNihiloEffect);
