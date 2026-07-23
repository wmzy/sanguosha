// 火攻 CardEffect — 普通锦囊·火攻的使用结算。
//
// resolve（单目标）：询问无懈可击 → 请求目标展示手牌 → 使用者弃同花色 → 火焰伤害。
//
// 跨玩家 respond（展示/弃牌）仍保留在 skill 中（按 requestType 分流）。
// resolve 内部通过 localVars 与 respond action 通信。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 火攻的结算：展示手牌 → 弃同花色 → 火焰伤害 */
async function resolveFireAttack(ctx: ResolveCtx): Promise<void> {
  const { state, source, target, cardId } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理
  const targetPlayer = state.players[target];
  if (!targetPlayer || targetPlayer.hand.length === 0) return;

  // 清理上轮残留
  delete state.localVars['火攻/展示'];
  delete state.localVars['火攻/展示花色'];
  delete state.localVars['火攻/弃牌'];

  // ── 1) 请求目标展示一张手牌 ──
  const revealFallback = targetPlayer.hand[0];
  await applyAtom(state, {
    type: '请求回应',
    requestType: '火攻/展示',
    target,
    prompt: {
      type: 'useCard',
      title: '火攻:展示一张手牌',
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
    timeout: 15,
  });

  let revealed = state.localVars['火攻/展示'] as
    | { cardId: string; suit: string }
    | undefined;
  if (!revealed) {
    const rc = state.cardMap[revealFallback];
    revealed = { cardId: revealFallback, suit: rc?.suit ?? '' };
    state.localVars['火攻/展示'] = revealed;
    state.localVars['火攻/展示花色'] = revealed.suit;
  }
  const revealedSuit = revealed.suit;

  // ── 2) 请求使用者弃一张同花色手牌 ──
  const fromPlayer = state.players[source];
  if (!fromPlayer?.alive) return;
  const hasMatch = fromPlayer.hand.some((id) => state.cardMap[id]?.suit === revealedSuit);
  if (!hasMatch) return;

  delete state.localVars['火攻/弃牌'];
  await applyAtom(state, {
    type: '请求回应',
    requestType: '火攻/弃牌',
    target: source,
    prompt: {
      type: 'useCard',
      title: `火攻:弃置一张 ${revealedSuit} 手牌对其造成1点火焰伤害(不弃则无效)`,
      cardFilter: {
        filter: (c) => c.suit === revealedSuit,
        min: 1,
        max: 1,
      },
    },
    timeout: 15,
  });

  const discardId = state.localVars['火攻/弃牌'] as string | undefined;
  if (discardId && state.players[target]?.alive) {
    await applyAtom(state, { type: '弃置', player: source, cardIds: [discardId] });
    await applyAtom(state, {
      type: '造成伤害',
      target,
      amount: 1,
      source,
      cardId,
      damageType: '火焰',
    });
  }
}

/** 火攻牌特有校验：目标有手牌、非自己 */
function canUseFireAttack(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const targets = params.targets as number[] | undefined;
  if (!Array.isArray(targets) || targets.length !== 1) return '火攻只能指定一名目标';
  const target = targets[0];
  if (target === ownerId) return '不能对自己使用火攻';
  const targetPlayer = state.players[target];
  if (!targetPlayer?.alive) return '目标不合法';
  if (targetPlayer.hand.length === 0) return '目标必须有手牌';
  return null;
}

const fireAttackEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'other', min: 1, max: 1 },
  canUse: canUseFireAttack,
  resolve: resolveFireAttack,
  // respond：按 requestType 分流 '火攻/展示'（目标展示手牌）和 '火攻/弃牌'（使用者弃同花色）。
  // 原逻辑来自 src/engine/skills/火攻.ts 的 respond registerAction。
  respond: {
    validate: (state, ownerId, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是火攻窗口';
      const reqType = (slot.atom as { requestType?: string }).requestType;
      if (reqType !== '火攻/展示' && reqType !== '火攻/弃牌')
        return '当前不是火攻窗口';
      const cardId = params.cardId as string;
      if (typeof cardId !== 'string') return 'cardId required';
      const self = state.players[ownerId];
      if (!self?.alive) return '你已死亡';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      if (reqType === '火攻/弃牌') {
        const revealedSuit = state.localVars['火攻/展示花色'] as string | undefined;
        const card = state.cardMap[cardId];
        if (!revealedSuit || card?.suit !== revealedSuit)
          return '必须弃置与展示牌相同花色的手牌';
      }
      return null;
    },
    execute: async (state, ownerId, params) => {
      const slot = state.pendingSlots.get(ownerId)!;
      const reqType = (slot.atom as { requestType: string }).requestType;
      const cardId = params.cardId as string;
      const card = state.cardMap[cardId];
      if (reqType === '火攻/展示') {
        state.localVars['火攻/展示'] = { cardId, suit: card?.suit ?? '' };
        state.localVars['火攻/展示花色'] = card?.suit ?? '';
      } else {
        state.localVars['火攻/弃牌'] = cardId;
      }
    },
  },
  prompt: {
    type: 'useCardAndTarget',
    title: '火攻',
    cardFilter: { filter: (c: Card) => c.name === '火攻', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  } as ActionPrompt,
  // respond 入口 UI：展示/弃牌窗口可选任意手牌（后端 validate 严格校验花色）
  respondPrompt: {
    type: 'useCard',
    title: '火攻',
    cardFilter: { filter: () => true, min: 1, max: 1 },
  } as ActionPrompt,
  label: '火攻',
  style: 'danger',
};

registerCardEffect('火攻', fireAttackEffect);
