// 酒 CardEffect — 基本牌·酒的使用结算。
//
// resolve: 加标记（本回合下一张杀伤害+1）。
// target.kind='self': 对自己使用。
// respond: 濒死时酒当桃用（见 respond 字段）。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { registerBeforeHook } from '../skill';
import { defaultPlayActive } from '../action-active';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';
import type { HookResult } from '../types';

/** 注册酒的全局「造成伤害」before-hook（消费增伤标记）。
 *  酒的使用者拥有 '酒/nextKillDamageBonus' 标记时，其造成的伤害 +1，然后消耗标记。
 *  全局注册(ownerId=-1)——酒是基本牌面能力，不限技能持有者。
 *  在 create-engine bootstrap 中调用。 */
export function registerWineHook(state: import('../types').GameState): void {
  registerBeforeHook(state, '酒', -1, '造成伤害时', async (ctx): Promise<HookResult | void> => {
    const atom = ctx.atom;
    if (atom.source === undefined) return;
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players[atom.source];
    if (!self) return;
    const hasMark = self.marks.some((m) => m.id === '酒/nextKillDamageBonus');
    if (!hasMark) return;
    await applyAtom(ctx.state, {
      type: '去标记',
      player: atom.source,
      markId: '酒/nextKillDamageBonus',
    });
    return {
      kind: 'modify',
      atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom,
    };
  });
}

/** 酒的结算：加增伤标记 */
async function resolveWine(ctx: ResolveCtx): Promise<void> {
  const { state, source } = ctx;
  await applyAtom(state, {
    type: '加标记',
    player: source,
    mark: { id: '酒/nextKillDamageBonus', scope: -1, payload: 1, duration: 'turn' },
  });
}

/** 酒牌特有校验：只能对自己使用 */
function canUseWine(
  _state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const target =
    (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
  if (target !== undefined && target !== ownerId) return '只能对自己使用酒';
  return null;
}

const wineEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'self' },
  canUse: canUseWine,
  resolve: resolveWine,
  // respond:濒死时酒当桃用——移动牌到弃牌堆并置 localVars['求桃/已救']=true。
  respond: {
    validate: (state, ownerId, params) => {
      if (state.pendingSlots.get(ownerId)?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (
        state.pendingSlots.get(ownerId)!.atom as unknown as Record<string, unknown>
      ).requestType as string;
      if (requestType !== '桃/求桃') return '当前不是求桃';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = state.cardMap[cardId];
      if (card.name !== '酒') return '只能用酒救援';
      return null;
    },
    execute: async (state, ownerId, params) => {
      const cardId = params.cardId as string;
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
    type: 'useCard',
    title: '饮酒',
    cardFilter: { filter: (c: Card) => c.name === '酒', min: 1, max: 1 },
  } as ActionPrompt,
  respondPrompt: {
    type: 'useCard',
    title: '濒死:使用酒(当桃)',
    cardFilter: { filter: (c: Card) => c.name === '酒', min: 1, max: 1 },
  } as ActionPrompt,
  label: '酒',
  style: 'default',
  activeWhen: (ctx) => defaultPlayActive(ctx),
};

registerCardEffect('酒', wineEffect);
