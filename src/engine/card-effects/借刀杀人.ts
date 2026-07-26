// 借刀杀人 CardEffect — 普通锦囊·借刀杀人的使用结算。
//
// resolve（单目标 A）：询问无懈可击 → 请求 A 出杀(useCardAndTarget) → 检查 A 的选择。
//   A 出杀 → useCard(quotaPolicy='none', mandatedTargets:[B]) 走完整杀结算
//           （询问闪 → 伤害,damageType 自动传导,火杀/雷杀不再丢失属性）。
//   A 不出杀 → 使用者获得 A 的武器。
//
// 双目标特殊处理：targets=[A]（武器持有者），killTarget=B 存入 localVars。
// resolve 通过 ctx.state.localVars['借刀杀人/killTarget'] 读取 B。
// A 的「出杀」选择由 skills/借刀杀人.ts 的 respond action 写入
// localVars['借刀杀人/出杀选择'] = { cardId, targets }。

import type { Card, GameState } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom } from '../create-engine';
import { useCard } from '../card-effect/use-card';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 从 target 处卸下武器并交给 source(借刀杀人“不出杀/交武器”分支) */
async function acquireWeapon(state: GameState, source: number, target: number): Promise<void> {
  const weaponId = state.players[target]?.equipment['武器'];
  if (!weaponId) return;
  await applyAtom(state, { type: '卸下', player: target, slot: '武器' });
  await applyAtom(state, { type: '获得', player: source, cardId: weaponId, from: target });
}

/** 借刀杀人的结算：请求出杀 → 读取选择 → useCard 杀结算/获得武器 */
async function resolveBorrowedSword(ctx: ResolveCtx): Promise<void> {
  const { state, source, target } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理
  const killTarget = state.localVars['借刀杀人/killTarget'] as number;
  const killTargetName = state.players[killTarget]?.name ?? '?';

  // 请求 A 选择：出杀(含 B/方天画戟多目标) 或 交出武器
  await applyAtom(state, {
    type: '请求回应',
    requestType: '借刀杀人/出杀',
    target,
    prompt: {
      type: 'useCardAndTarget',
      title: `借刀杀人:对 ${killTargetName} 使用一张杀,或交出武器`,
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
      // 方天画戟等允许多目标;距离/必含 B 由后端 canUse + mandatedTargets 校验
      targetFilter: { min: 1, max: 3, filter: () => true },
    },
    timeout: 20,
  });

  const choice = state.localVars['借刀杀人/出杀选择'] as
    | { cardId: string; targets: number[] }
    | undefined;
  delete state.localVars['借刀杀人/出杀选择'];

  if (choice) {
    // respond validate 已保证 killTarget ∈ targets + 全部在攻击范围;useCard 正常应成功
    // (quotaPolicy='none' → 不计出杀次数;mandatedTargets=[B] → 强制必含发起者指定的 killTarget)
    const err = await useCard(state, target, choice.cardId, choice.targets, {
      quotaPolicy: 'none',
      mandatedTargets: [killTarget],
    });
    if (err) {
      // 防御兜底:理论上不会发生(respond 已校验),但避免 useCard 静默白费——回落到交武器
      await acquireWeapon(state, source, target);
    }
  } else {
    // 未选(pass/超时)= 交出武器
    await acquireWeapon(state, source, target);
  }
}

/** 借刀杀人牌特有校验：目标有武器、killTarget 合法、非自己 */
function canUseBorrowedSword(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  // 兼容 targets=[A,B] 和 target=A+killTarget=B 两种格式
  let targetIdx: number | undefined;
  let killTargetIdx: number | undefined;
  if (
    Array.isArray(params.targets) &&
    (params.targets as unknown[]).length >= 2 &&
    typeof (params.targets as unknown[])[0] === 'number' &&
    typeof (params.targets as unknown[])[1] === 'number'
  ) {
    const arr = params.targets as number[];
    targetIdx = arr[0];
    killTargetIdx = arr[1];
  } else {
    targetIdx = params.target as number | undefined;
    killTargetIdx = params.killTarget as number | undefined;
  }
  if (typeof targetIdx !== 'number') return 'target required';
  if (typeof killTargetIdx !== 'number') return 'killTarget required';
  const target = state.players[targetIdx];
  if (!target?.alive) return '目标不合法';
  if (!target.equipment['武器']) return '目标没有武器';
  if (targetIdx === ownerId) return '不能对自己使用';
  const killTargetPlayer = state.players[killTargetIdx];
  if (!killTargetPlayer?.alive) return '杀的目标不合法';
  if (killTargetIdx === ownerId) return '不能指定自己为杀的目标';
  if (killTargetIdx === targetIdx) return '杀的目标不能是借刀杀人目标';
  return null;
}

const borrowedSwordEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'other', min: 1, max: 1 },
  canUse: canUseBorrowedSword,
  resolve: resolveBorrowedSword,
  // 双目标预处理：targets=[A,B] 或 target=A+killTarget=B。
  // 提取 killTarget 存入 localVars，返回 [A] 作为锦囊真实目标传给 runUseFlow。
  preUse: (state, _ownerId, params) => {
    let targetIdx: number;
    let killTargetIdx: number;
    if (
      Array.isArray(params.targets) &&
      (params.targets as unknown[]).length >= 2 &&
      typeof (params.targets as unknown[])[0] === 'number' &&
      typeof (params.targets as unknown[])[1] === 'number'
    ) {
      const arr = params.targets as number[];
      targetIdx = arr[0];
      killTargetIdx = arr[1];
    } else {
      targetIdx = params.target as number;
      killTargetIdx = params.killTarget as number;
    }
    state.localVars['借刀杀人/killTarget'] = killTargetIdx;
    return [targetIdx];
  },
  prompt: {
    type: 'useCardAndTarget',
    title: '借刀杀人',
    cardFilter: { filter: (c: Card) => c.name === '借刀杀人', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  } as ActionPrompt,
  label: '借刀杀人',
  style: 'danger',
};

registerCardEffect('借刀杀人', borrowedSwordEffect);
