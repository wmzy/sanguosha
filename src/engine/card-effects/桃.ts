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
  // respond:濒死求桃时出桃救援——移动牌到弃牌堆并置 localVars['求桃/已救']=true,
  // runDyingFlow 据此判断是否有人救援。
  respond: {
    validate: (state, ownerId, params) => {
      // pending 必须是 请求回应 且 requestType='求桃'
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      if (slot.atom.type !== '请求回应') return '当前不是求桃';
      const requestType = (slot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '桃/求桃') return '当前不是求桃';
      const cardId = params.cardId as string | undefined;
      if (cardId) {
        const self = state.players[ownerId];
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (card.name !== '桃') return '只能用桃救援';
      }
      return null;
    },
    execute: async (state, ownerId, params) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return;
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '弃牌堆' },
      });
      state.localVars['求桃/已救'] = true;
    },
  },
  prompt: {
    type: 'useCardAndTarget',
    title: '出桃',
    cardFilter: { filter: (c: Card) => c.name === '桃', min: 1, max: 1 },
    targetFilter: { min: 0, max: 1 },
  } as ActionPrompt,
  respondPrompt: {
    type: 'useCard',
    title: '打出桃',
    cardFilter: { filter: (c: Card) => c.name === '桃', min: 1, max: 1 },
  } as ActionPrompt,
  label: '桃',
  style: 'primary',
  activeWhen: (ctx) => defaultPlayActive(ctx),
};

registerCardEffect('桃', peachEffect);
