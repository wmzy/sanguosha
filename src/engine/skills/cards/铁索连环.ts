// 铁索连环 CardEffect — 普通锦囊·铁索连环的使用结算。
//
// resolve（逐目标）：询问无懈可击 → 按目标当前状态自动切换连环状态（toggle）：
//   未横置 → 横置；已横置 → 重置。不由目标选择（对齐官方 OL 行为）。
// 可对一至两名角色使用（含自己）。
//
// 重铸(recast)不走 runUseFlow，由 skills/铁索连环.ts 的 recast action 处理。
// 连环传导(属性伤害联动)在 face-down.ts 的 registerChainConductionHook，
//   由 index 作为伤害结算基础设施注册。

import type { Card, GameState, Json } from '../../types';
import { applyAtom } from '../../core/apply';
import { frameCards, popFrame, pushFrame } from '../../core/frame';
import { setChain, isChained } from '../../flows/face-down';
import { promptCancel } from '../../flows/cancel';
import { validateUseCard } from '../../core/skill';
import type { CardEffect, ResolveCtx } from '../../types';

/** 铁索连环的逐目标结算：按当前状态切换（未横置→横置，已横置→重置）。
 *  可指定两个目标，每个目标各自独立切换。 */
async function resolveChain(ctx: ResolveCtx): Promise<void> {
  const { state, target } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理（per-target 抵消）。
  await setChain(state, target, !isChained(state, target));
}

/** 铁索连环牌特有校验：1-2 名存活角色（含自己） */
function canUseChain(
  state: import('../../types').GameState,
  _ownerId: number,
  params: Record<string, import('../../types').Json>,
): string | null {
  const targets = params.targets as number[] | undefined;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 2)
    return '需选择一至两名角色';
  for (const t of targets) {
    if (!state.players[t]?.alive) return '目标不合法';
  }
  return null;
}

/** 铁索连环手动结算 use 的 validate+execute 工厂（整卡一次无懈的手动结算路径）。
 *  标版 use 走 use-card.ts 通用注册（runUseFlow + 逐目标 resolveChain）；
 *  界庞统「界连环」覆盖标版 use 时保持本手动序列（帧/无懈询问参数/横置切换/异常清理
 *  逐字保留），与标版的唯一实质差异 targets 上限由 maxTargets 注入（界版 3）。 */
export function makeChainUseHandlers(ownerId: number, maxTargets: number) {
  return {
    validate: (state: GameState, params: Record<string, Json>): string | null => {
      const base = validateUseCard(state, ownerId, params, { cardName: '铁索连环' });
      if (base) return base;
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length < 1 || targets.length > maxTargets)
        return `需选择一至${maxTargets}名角色`;
      for (const t of targets) {
        if (!state.players[t]?.alive) return '目标不合法';
      }
      return null;
    },
    execute: async (state: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const targets = params.targets as number[];
      await pushFrame(state, '铁索连环', from, { ...params });
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      try {
        const cancelled = await promptCancel(state, { cardName: '无懈可击', broadcast: true }, from, from);
        if (!cancelled) {
          for (const t of targets) {
            const chained = isChained(state, t);
            await setChain(state, t, !chained);
          }
        }
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        if (frameCards(state).includes(cardId)) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
        await popFrame(state);
      }
    },
  };
}

export const chainEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'any', min: 1, max: 2 },
  canUse: canUseChain,
  resolve: resolveChain,
  prompt: {
    type: 'useCardAndTarget',
    title: '铁索连环',
    cardFilter: { filter: (c: Card) => c.name === '铁索连环', min: 1, max: 1 },
    targetFilter: { min: 1, max: 2, allowSelf: true },
  },
  label: '铁索连环',
  style: 'primary',
};
