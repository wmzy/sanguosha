// 闪 CardEffect — 基本牌·闪的使用结算。
//
// 使用时机：以你为目标的【杀】生效前。
// 使用目标：以你为目标的【杀】（kind='effect'，非玩家）。
// 作用效果：抵消此【杀】。
//
// 闪走 runUseFlow（与杀/锦囊一致），流程：
//   杀的 runSettlementPhase「生效前」→ 询问抵消（定向询问杀目标）→
//   目标 respond 出闪 → play-card respond 包装调 runUseFlow(闪) →
//   闪帧压栈 → runSettlementPhase(闪) → resolve 设下层帧（杀帧）cancelled=true →
//   闪帧弹栈 → 询问抵消循环检测到 cancelled=true → 退出。
//
// 无双/肉林在「被抵消」after-hook 中拦截（清除杀帧 cancelled + 要求第二张闪）。
//
// 闪的色限制（诸葛连弩等）由 effect.respond.validate 校验。

import type { Card, GameState, Json } from '../types';
import type { ActionPrompt } from '../types';
import {
  registerCardEffect,
  type CardEffect,
} from '../card-effect/registry';
import type { Color } from '../../shared/types';

const COLOR_LIMIT_VAR = '闪/色限制';

/** 闪 CardEffect — respond-only：成为杀的目标时打出闪抵消。
 *  resolve = 闪的使用效果 = 设下层帧（杀帧）的 cancelled 字段为 true。 */
const dodgeEffect: CardEffect = {
  timing: '生效前',
  target: { kind: 'effect' },
  resolve: async (ctx) => {
    // 下层帧（stack[length-2]）= 被抵消的牌的帧（杀/万箭齐发等）。
    // 闪帧（stack[length-1]）是本帧，resolve 时它正在生效。
    const { state } = ctx;
    const targetFrame = state.settlementStack[state.settlementStack.length - 2];
    if (targetFrame) targetFrame.cancelled = true;
  },
  respond: {
    validate: (state: GameState, ownerId: number, params: Record<string, Json>) => {
      // 闪通过 询问抵消 的定向模式（询问闪 atom）触发；
      // 也兼容旧的 询问闪 slot（无双第二次询问、借刀杀人等仍用 询问闪 atom）。
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      const isDodgeWindow =
        slot.atom.type === '询问闪' ||
        (slot.atom.type === '请求回应' &&
          (slot.atom as { requestType?: string }).requestType === '闪');
      if (!isDodgeWindow) return '当前不是出闪的窗口';
      const cardId = params.cardId as string | undefined;
      if (cardId) {
        const self = state.players[ownerId];
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (card?.name !== '闪') return '只能打出闪';
        const limit = state.localVars[COLOR_LIMIT_VAR] as Color | undefined;
        if (limit && card.color !== limit) return `只能打出${limit}色的闪`;
      }
      return null;
    },
    // execute 已由 play-card.ts 的 effect kind 包装统一接管：runUseFlow(闪)。
    execute: async () => {},
  },
  prompt: {
    type: 'useCard',
    title: '打出闪',
    cardFilter: { filter: (c: Card) => c.name === '闪', min: 1, max: 1 },
  } as ActionPrompt,
  respondPrompt: {
    type: 'useCard',
    title: '打出闪',
    cardFilter: { filter: (c: Card) => c.name === '闪', min: 1, max: 1 },
  } as ActionPrompt,
  label: '闪',
  style: 'default',
};

registerCardEffect('闪', dodgeEffect);
