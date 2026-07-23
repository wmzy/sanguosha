// 无懈可击 CardEffect — 即时锦囊·无懈可击。
//
// 无懈可击走 runUseFlow（与杀/锦囊一致），流程：
//   锦囊的 runSettlementPhase「生效前」→ 询问抵消（广播）→
//   任意玩家 respond 出无懈 → play-card respond 包装调 runUseFlow(无懈) →
//   无懈帧压栈 → runSettlementPhase(无懈)（无懈本身是锦囊，递归询问反无懈）→
//   resolve 设下层帧（被抵消锦囊帧）cancelled=true → 无懈帧弹栈 →
//   询问抵消循环检测 cancelled=true → 退出。
//
// 无懈可击本身可被无懈可击抵消（递归嵌套），由 runSettlementPhase 自动推导 cancelledBy 处理。

import type { Card, GameState, Json } from '../types';
import type { ActionPrompt } from '../types';
import { findPendingSlot } from '../skill';
import {
  registerCardEffect,
  type CardEffect,
} from '../card-effect/registry';

const CARD_NAME = '无懈可击';

const nullificationEffect: CardEffect = {
  timing: '生效前',
  target: { kind: 'effect' },
  // resolve = 无懈可击的使用效果 = 设下层帧（被抵消锦囊帧）的 cancelled 字段为 true。
  resolve: async (ctx) => {
    const { state } = ctx;
    const targetFrame = state.settlementStack[state.settlementStack.length - 2];
    if (targetFrame) targetFrame.cancelled = true;
  },
  respond: {
    validate: (state: GameState, ownerId: number, params: Record<string, Json>) => {
      // 无懈可击是广播型(target=TARGET_BROADCAST):先按 ownerId 查(并行询问场景下 ownerId 也可能命中),
      // 未命中时查找广播型 slot(findPendingSlot 统一 fallback)。
      const slot = findPendingSlot(state, ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是无懈可击窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== CARD_NAME) return '当前不是无懈可击窗口';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self.alive) return '你已死亡';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = state.cardMap[cardId];
      if (card.name !== CARD_NAME) return '只能打出无懈可击';
      return null;
    },
    // execute 已由 play-card.ts 的 effect kind 包装统一接管：runUseFlow(无懈可击)。
    execute: async () => {},
  },
  prompt: {
    type: 'useCard',
    title: '打出无懈可击',
    cardFilter: { filter: (c: Card) => c.name === CARD_NAME, min: 1, max: 1 },
  } as ActionPrompt,
  respondPrompt: {
    type: 'useCard',
    title: '打出无懈可击',
    cardFilter: { filter: (c: Card) => c.name === CARD_NAME, min: 1, max: 1 },
  } as ActionPrompt,
  label: CARD_NAME,
  style: 'danger',
};

registerCardEffect(CARD_NAME, nullificationEffect);
