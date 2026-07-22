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

import type { GameState } from '../types';
import { applyAtom, frameCards, topFrame } from '../create-engine';
import { registerAfterHook } from '../skill';
import { setCancelled } from '../card-effect/registry';

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
