// 铁索连环 CardEffect — 普通锦囊·铁索连环的使用结算。
//
// resolve（逐目标）：询问无懈可击 → 横置/重置连环状态。
// 可对一至两名角色使用（含自己）。
//
// 重铸(recast)不走 runUseFlow，由 skills/铁索连环.ts 的 recast action 处理。
// 连环传导(属性伤害联动)在 face-down.ts 的 registerChainConductionHook，
//   由 index 作为伤害结算基础设施注册。

import type { Card } from '../types';
import { setChain } from '../flows/face-down';
import { applyAtom } from '../index';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 目标选择横置/重置的 requestType（resolve 发出 → respond 写回 localVars）。 */
const CHOOSE_RT = '铁索连环/choose';
/** localVars key：目标的选择（'横置' | '重置'）。 */
const CHOICE_KEY = '铁索连环/choice';

/** 铁索连环的逐目标结算：询问目标选择横置或重置。
 *  规则（rules/card/scroll.md）：目标角色选择一项——1.横置；2.重置。
 *  已横置可选「横置」维持现状、未横置可选「重置」维持现状，故不能强制翻转（toggle）。 */
async function resolveChain(ctx: ResolveCtx): Promise<void> {
  const { state, target } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理（per-target 抵消）。

  // 询问目标：横置还是重置。可指定两个目标，每个目标各自独立选择。
  delete state.localVars[CHOICE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CHOOSE_RT,
    target,
    prompt: {
      type: 'chooseOption',
      title: '铁索连环：选择一项',
      options: [
        { value: '横置', label: '横置' },
        { value: '重置', label: '重置' },
      ],
    },
    timeout: 15,
  });

  const choice = state.localVars[CHOICE_KEY] as string | undefined;
  delete state.localVars[CHOICE_KEY];
  // 超时未选择：维持现状，不强制翻转状态（视同目标放弃操作）。
  if (choice === '横置') {
    await setChain(state, target, true);
  } else if (choice === '重置') {
    await setChain(state, target, false);
  }
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
  target: { kind: 'any', min: 1, max: 2 },
  canUse: canUseChain,
  resolve: resolveChain,
  // respond：目标对「铁索连环/choose」横置/重置选择问询的回应入口。
  // 由 play-card(打出牌) 按卡名 skillId 注册到每个座次——目标可能是任意玩家，跨座次回应。
  respond: {
    validate: (state, ownerId, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是铁索连环选择';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== CHOOSE_RT) return '当前不是铁索连环选择';
      const option = params.option as string | undefined;
      if (option !== '横置' && option !== '重置') return '请选择横置或重置';
      return null;
    },
    execute: async (state, _ownerId, params) => {
      state.localVars[CHOICE_KEY] = params.option;
    },
  },
  prompt: {
    type: 'useCardAndTarget',
    title: '铁索连环',
    cardFilter: { filter: (c: Card) => c.name === '铁索连环', min: 1, max: 1 },
    targetFilter: { min: 1, max: 2, allowSelf: true },
  },
  // respond 入口 UI（目标横置/重置选择面板）；pending 实际 prompt 由 请求回应 atom 投影。
  respondPrompt: {
    type: 'chooseOption',
    title: '铁索连环：选择一项',
    options: [
      { value: '横置', label: '横置' },
      { value: '重置', label: '重置' },
    ],
  },
  label: '铁索连环',
  style: 'primary',
};

registerCardEffect('铁索连环', chainEffect);
