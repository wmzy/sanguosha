// 闪 CardEffect — 基本牌·闪的使用结算。
//
// 使用时机：以你为目标的【杀】生效前。
// 使用目标：以你为目标的【杀】。
// 作用效果：抵消此【杀】。
//
// 闪是基本牌,任何玩家成为杀的目标时都可使用闪——不依赖玩家技能列表中是否有'闪'。
// 故闪的「生效前」after-hook 全局注册(ownerId=-1),在模块加载时由 index.ts → use-card.ts
// 的 onInit 或系统规则触发。
//
// 流程:杀的「生效前」→ 闪的 after-hook 询问闪 → respond action 移牌+设置标记 →
// drain闪 → 无双/肉林在「询问闪」after-hook 中拦截第一次。

import type { Card, GameState, Json } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom, frameCards, topFrame } from '../create-engine';
import { registerAfterHook } from '../skill';
import {
  registerCardEffect,
  type CardEffect,
  setCancelled,
} from '../card-effect/registry';
import type { Color } from '../../shared/types';

/**
 * 注册闪的「生效前」全局 after-hook。
 * 在杀的「生效前」时机询问目标是否使用闪,设置已抵消标记,drain闪。
 *
 * 全局注册(ownerId=-1)——闪是基本牌面能力,适用于所有玩家,不限闪技能持有者。
 * 标记来源:respond action（玩家出闪时设置）或此处检测处理区（八卦阵虚拟闪等 cancel 询问闪的场景）。
 */
export function registerDodgeHook(state: GameState): void {
  registerAfterHook(state, '闪', -1, '生效前', async (ctx) => {
    const atom = ctx.atom as { source: number; target: number; cardId: string };
    const card = ctx.state.cardMap[atom.cardId];
    if (!card || card.name !== '杀') return;
    if (!ctx.state.players[atom.target]?.alive) return;

    // 询问是否使用闪
    await applyAtom(ctx.state, { type: '询问闪', target: atom.target, source: atom.source });

    // 检查处理区:有没有闪牌(玩家出闪 / 八卦阵虚拟闪)
    const dodgeIds = frameCards(ctx.state).filter((id) => ctx.state.cardMap[id]?.name === '闪');
    if (dodgeIds.length > 0) {
      // 设置已抵消标记（补保 respond action 未设置的场景,如八卦阵虚拟闪）
      setCancelled(ctx.state, atom.cardId, atom.target);
      // drain 闪到弃牌堆
      for (const id of dodgeIds) {
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: id,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    }
  });
}

const COLOR_LIMIT_VAR = '闪/色限制';

/** 闪 CardEffect — respond-only：成为杀的目标时打出闪抵消。
 *  无 use resolve（闪的使用效果 = respond 中设置的已抵消标记）。 */
const dodgeEffect: CardEffect = {
  timing: '杀生效前',
  target: { kind: 'effect' },
  resolve: async () => {},
  respond: {
    validate: (state: GameState, ownerId: number, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      if (slot.atom.type !== '询问闪') return '当前不是出闪的窗口';
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
    execute: async (state: GameState, ownerId: number, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return; // 不出闪
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '处理区' },
      });
      // 设置已抵消标记：闪的效果 = 抵消目标杀
      // 从结算帧栈顶部找到杀帧,设置标记
      const frame = topFrame(state);
      if (frame) {
        const killCardId = frame.params.cardId as string | undefined;
        if (killCardId && state.cardMap[killCardId]?.name === '杀') {
          setCancelled(state, killCardId, ownerId);
        }
      }
    },
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
