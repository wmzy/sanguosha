// 无懈可击 CardEffect — 响应锦囊·无懈可击的 respond action。
//
// 无懈可击是 respond-only 即时锦囊：任何角色可在锦囊生效前打出，抵消其效果。
// 不走标准使用流程（无 use action / 无 runUseFlow）——只注册 respond action。
//
// respond validate/execute 镜像原 src/engine/skills/无懈可击.ts 的逻辑：
//   validate: pending 必须是 请求回应 + requestType='无懈可击' + 牌名='无懈可击'
//   execute: 牌进处理区→弃牌堆；翻转 localVars[`无懈/被抵消/${cancelTarget}`]；
//            标记 localVars[`无懈/已回应/${cancelTarget}`]=true（询问无懈可击 循环据此开新窗口）
//
// 抵消机制（close-reopen）见 src/engine/无懈可击.ts 的 询问无懈可击 helper。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { findPendingSlot } from '../skill';
import {
  registerCardEffect,
  type CardEffect,
} from '../card-effect/registry';

const CARD_NAME = '无懈可击';

const nullificationEffect: CardEffect = {
  // 无懈可击不走 use 流程；timing='生效前' 表示它在锦囊生效前作为回应打出。
  timing: '生效前',
  target: { kind: 'effect' },
  resolve: async () => {},
  respond: {
    validate: (state, ownerId, params) => {
      // 无懈可击是广播型(target=TARGET_BROADCAST):先按 ownerId 查(并行询问场景下 ownerId 也可能命中),
      // 未命中时查找广播型 slot(findPendingSlot 统一 fallback)。
      const slot = findPendingSlot(state, ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是无懈可击窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '无懈可击') return '当前不是无懈可击窗口';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self.alive) return '你已死亡';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = state.cardMap[cardId];
      if (card.name !== CARD_NAME) return '只能打出无懈可击';
      return null;
    },
    execute: async (state, ownerId, params) => {
      const cardId = params.cardId as string;
      // 无懈可击牌先进处理区(与杀/闪一致),让处理区临时展示锦囊+无懈可击的完整结算画面。
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '处理区' },
      });
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });

      // 确定本次抵消的目标:从当前 broadcast slot 的 atom.cancelTarget 读取。
      const slot = findPendingSlot(state, ownerId);
      const cancelAtom = slot?.atom as { cancelTarget?: number } | undefined;
      const cancelTarget =
        typeof cancelAtom?.cancelTarget === 'number' ? cancelAtom.cancelTarget : -1;
      const cancelKey = `无懈/被抵消/${cancelTarget}`;

      // 翻转抵消状态:打出一张无懈 = 翻转当前锦囊对 cancelTarget 是否被抵消
      const cancelled = state.localVars[cancelKey] as boolean | undefined;
      state.localVars[cancelKey] = !cancelled;

      // 标记本次窗口有人 respond，询问无懈可击 循环据此决定是否开新窗口。
      state.localVars[`无懈/已回应/${cancelTarget}`] = true;
    },
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
