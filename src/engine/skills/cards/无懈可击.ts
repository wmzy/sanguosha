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

import type { Card, GameState, Json } from '../../types';
import { findPendingSlot } from '../../core/skill';
import { setFrameCancelled } from '../../core/frame';
import { requireHandCard } from '../../util/skillRuntime';
import type { CardEffect } from '../../types';

const CARD_NAME = '无懈可击';

/** 无懈可击 respond validate(标版规则):无懈窗口 + 手牌中的无懈牌。
 *  具名导出供 界看破 的 respond override 复用(其校验同标版,单源维护)。 */
export function nullifyRespondValidate(
  state: GameState,
  ownerId: number,
  params: Record<string, Json>,
): string | null {
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
  const handCheck = requireHandCard(state, ownerId, cardId, CARD_NAME);
  if (handCheck) return handCheck;
  return null;
}

export const nullificationEffect: CardEffect = {
  timing: '生效前',
  target: { kind: 'effect' },
  // resolve = 无懈可击的使用效果 = 设下层帧（被抵消锦囊帧）的 cancelled 字段为 true。
  resolve: async (ctx) => {
    const { state } = ctx;
    const targetFrame = state.settlementStack[state.settlementStack.length - 2];
    await setFrameCancelled(state, targetFrame, true);
  },
  respond: {
    validate: nullifyRespondValidate,
    // execute 已由 play-card.ts 的 effect kind 包装统一接管：runUseFlow(无懈可击)。
    execute: async () => {},
  },
  prompt: {
    type: 'useCard',
    title: '打出无懈可击',
    cardFilter: { filter: (c: Card) => c.name === CARD_NAME, min: 1, max: 1 },
  },
  respondPrompt: {
    type: 'useCard',
    title: '打出无懈可击',
    cardFilter: { filter: (c: Card) => c.name === CARD_NAME, min: 1, max: 1 },
  },
  label: CARD_NAME,
  style: 'danger',
};

