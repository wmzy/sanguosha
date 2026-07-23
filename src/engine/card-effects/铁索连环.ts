// 铁索连环 CardEffect — 普通锦囊·铁索连环的使用结算。
//
// resolve（逐目标）：询问无懈可击 → 横置/重置连环状态。
// 可对一至两名角色使用（含自己）。
//
// 注意：重铸(recast)不走 runUseFlow，仍在 skill 中保留独立 action。
// 连环传导 after-hook（全局唯一）也仍在 skill 中注册。

import type { Card, GameState } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

const CHAIN_MARK = 'chained';

function isChained(state: GameState, idx: number): boolean {
  return state.players[idx]?.marks.some((m) => m.id === CHAIN_MARK) ?? false;
}

/** 铁索连环的逐目标结算：toggle 横置 */
async function resolveChain(ctx: ResolveCtx): Promise<void> {
  const { state, target } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理（per-target 抵消）。

  const chained = isChained(state, target);
  await applyAtom(state, { type: '设横置', player: target, chained: !chained });
}

/** 铁索连环牌特有校验：1-2 名存活角色（含自己） */
function canUseChain(
  state: import('../types').GameState,
  _ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const targets = params.targets as number[] | undefined;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 2)
    return '需选择一至两名角色';
  for (const t of targets) {
    if (!state.players[t]?.alive) return '目标不合法';
  }
  return null;
}

const chainEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'other', min: 1, max: 2 },
  canUse: canUseChain,
  resolve: resolveChain,
  prompt: {
    type: 'useCardAndTarget',
    title: '铁索连环',
    cardFilter: { filter: (c: Card) => c.name === '铁索连环', min: 1, max: 1 },
    targetFilter: { min: 1, max: 2 },
  } as ActionPrompt,
  label: '铁索连环',
  style: 'primary',
};

registerCardEffect('铁索连环', chainEffect);
