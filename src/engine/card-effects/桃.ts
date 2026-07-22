// 桃 CardEffect — 基本牌·桃的使用结算。
//
// resolve: 回复目标 1 点体力。
// target.kind='wounded': 可对包括自己在内的已受伤角色使用。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 桃的牌特有校验：目标必须已受伤 */
function canUsePeach(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const target =
    ((params.target ?? (params.targets as number[] | undefined)?.[0]) as number | undefined) ??
    ownerId;
  return state.players[target]?.alive === true &&
    state.players[target]?.health < state.players[target]?.maxHealth
    ? null
    : '桃只能对受伤角色使用';
}

/** 桃的结算：回复目标 1 点体力 */
async function resolvePeach(ctx: ResolveCtx): Promise<void> {
  const { state, source, target } = ctx;
  await applyAtom(state, { type: '回复体力', target, amount: 1, source });
}

const peachEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'wounded', min: 0, max: 1 },
  canUse: canUsePeach,
  resolve: resolvePeach,
  prompt: {
    type: 'useCardAndTarget',
    title: '出桃',
    cardFilter: { filter: (c: Card) => c.name === '桃', min: 1, max: 1 },
    targetFilter: { min: 0, max: 1 },
  } as ActionPrompt,
  label: '桃',
  style: 'primary',
  activeWhen: (ctx) => defaultPlayActive(ctx),
};

registerCardEffect('桃', peachEffect);
