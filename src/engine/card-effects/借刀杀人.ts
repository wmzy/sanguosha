// 借刀杀人 CardEffect — 普通锦囊·借刀杀人的使用结算。
//
// resolve（单目标 A）：询问无懈可击 → 请求目标出杀 → 检查处理区。
//   目标出杀 → 对 killTarget 执行杀的效果（询问闪 → 伤害）。
//   目标不出杀 → 使用者获得目标的武器。
//
// 双目标特殊处理：targets=[A]（武器持有者），killTarget=B 存入 localVars。
// resolve 通过 ctx.state.localVars['借刀杀人/killTarget'] 读取 B。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerCardEffect, type CardEffect, type ResolveCtx, isCancelled } from '../card-effect/registry';

/** 借刀杀人的结算：请求出杀 → 检查处理区 → 杀效果/获得武器 */
async function resolveBorrowedSword(ctx: ResolveCtx): Promise<void> {
  const { state, source, target } = ctx;
  // 无懈可击已由 runSettlementPhase 的「生效前」时机统一处理

  // 请求目标选择：出杀 或 交出武器
  await applyAtom(state, {
    type: '请求回应',
    requestType: '杀/forceKill',
    target,
    prompt: {
      type: 'useCard',
      title: '借刀杀人:请打出一张杀',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
    },
    timeout: 15,
  });

  // 检查处理区：有杀 = 出了杀
  const killCardId = frameCards(state).find((id) => state.cardMap[id]?.name === '杀');

  if (killCardId) {
    // 目标出了杀：移到弃牌堆，对 killTarget 执行杀的效果
    await applyAtom(state, {
      type: '移动牌',
      cardId: killCardId,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });

    const killTarget = state.localVars['借刀杀人/killTarget'] as number;
    if (typeof killTarget === 'number' && state.players[killTarget]?.alive) {
      await applyAtom(state, {
        type: '指定目标',
        source: target,
        target: killTarget,
        cardId: killCardId,
      });
      await applyAtom(state, { type: '询问闪', target: killTarget, source: target });
      // 闪走 runUseFlow → resolve 设本帧（借刀杀人帧）cancelled=true；runUseFlow finally 自动移牌。
      if (!isCancelled(state, killCardId, killTarget)) {
        await applyAtom(state, {
          type: '造成伤害',
          target: killTarget,
          amount: 1,
          source: target,
          cardId: killCardId,
        });
      }
    }
  } else {
    // 不出杀：获得目标的武器
    const targetPlayer = state.players[target];
    const weaponId = targetPlayer?.equipment['武器'];
    if (weaponId) {
      await applyAtom(state, { type: '卸下', player: target, slot: '武器' });
      await applyAtom(state, {
        type: '获得',
        player: source,
        cardId: weaponId,
        from: target,
      });
    }
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
