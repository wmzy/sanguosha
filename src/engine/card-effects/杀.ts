// 杀 CardEffect — 基本牌·杀的使用结算。
//
// 将杀的单目标结算逻辑从 skills/杀.ts 的 execute 内联代码提取为 CardEffect.resolve。
// 解耦无双/肉林：通过 PostDodgeAskHook 机制，杀不再直接 import 无双/肉林。
//
// resolve 职责（runUseFlow 在逐目标循环中调用）：
//   询问闪 → postDodgeAskHooks(无双/肉林消耗闪并追加第二轮) → 检查处理区 → 被抵消/伤害
//
// onSettle 职责（runUseFlow 在结算完成后、popFrame 前调用）：
//   出杀次数累加（slash-quota）+ 回合用量 view 同步。

import type { Card } from '../types';
import type { ActionPrompt, GameView } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { inAttackRange } from '../distance';
import { viewCanAttack } from '../viewDistance';
import { canSlash, incSlashUsed, isSlashExempted, slashUsed } from '../slash-quota';
import { defaultPlayActive, viewCanSlash } from '../action-active';
import {
  registerCardEffect,
  runPostDodgeAskHooks,
  type CardEffect,
  type ResolveCtx,
} from '../card-effect/registry';

/** 杀的合法性追加检测（condition.md 牌特有校验） */
function canUseSlash(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const cardId = params.cardId as string | undefined;
  // 攻击范围校验
  const targetsOk =
    Array.isArray(params.targets) &&
    (params.targets as number[]).every((t) => {
      if (state.players[t]?.alive !== true) return false;
      return inAttackRange(state, ownerId, t, cardId);
    });
  if (!targetsOk) return '目标不合法';
  return canSlash(state, ownerId, cardId) ? null : '出杀次数已达上限';
}

/** 杀的单目标结算（询问闪 → 双闪hook → 检查处理区 → 被抵消/伤害） */
async function resolveSlash(ctx: ResolveCtx): Promise<void> {
  const { state, source, target, cardId } = ctx;
  const damageType = state.cardMap[cardId]?.damageType;

  // 生效前：询问闪（等待目标回应；八卦阵判红放虚拟闪后 cancel 由 before-hook 处理）
  await applyAtom(state, { type: '询问闪', target, source });

  // 无双/肉林：消耗已有闪并追加第二次询问（通过 PostDodgeAskHook 解耦）
  await runPostDodgeAskHooks(state, source, target);

  // 检查处理区：有没有闪牌（目标出闪 / 八卦阵虚拟闪）
  const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
  if (dodgeIds.length > 0) {
    // 被抵消：触发武器技（贯石斧强命 / 青龙追杀）
    await applyAtom(state, { type: '被抵消', source, target, cardId });
    const remaining = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (remaining.length > 0) {
      // 仍被抵消：drain 所有闪
      for (const dodgeCardId of remaining) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: dodgeCardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    } else {
      // 武器技逆转（贯石斧强命 / 青龙追杀命中）：处理区无闪 → 造成伤害
      await applyAtom(state, {
        type: '造成伤害',
        target,
        amount: 1,
        source,
        cardId,
        damageType,
      });
    }
  } else {
    // 没闪：造成伤害
    await applyAtom(state, {
      type: '造成伤害',
      target,
      amount: 1,
      source,
      cardId,
      damageType,
    });
  }
}

/** 杀的结算后回调：出杀次数累加 + view 同步 */
async function onSettleSlash(
  state: import('../types').GameState,
  source: number,
  cardId: string,
): Promise<void> {
  if (!isSlashExempted(state, source, cardId)) {
    incSlashUsed(state);
    await applyAtom(state, {
      type: '回合用量',
      player: source,
      key: '杀/usedCount',
      value: slashUsed(state),
    });
  }
}

const slashEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'inAttackRange', min: 1, max: 3 },
  canUse: canUseSlash,
  resolve: resolveSlash,
  onSettle: onSettleSlash,
  prompt: {
    type: 'useCardAndTarget',
    title: '出杀',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
    targetFilter: {
      min: 1,
      max: 3,
      filter: (view: GameView, t: number) =>
        viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
    },
  } as ActionPrompt,
  label: '杀',
  style: 'danger',
  activeWhen: (ctx) => defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx),
};

registerCardEffect('杀', slashEffect);
