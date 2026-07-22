// 杀 CardEffect — 基本牌·杀的使用结算。
//
// 作用效果（use.md 生效后）：对目标角色造成 1 点伤害。
//
// 闪的抵消逻辑不在杀的 resolve 中——由 use-card.ts 的 handleSlashDodge 在「生效前」
// 时机循环询间使用闪，发出闪的「生效前」atom。无双/肉林在该 atom 的 before-hook 中
// cancel 第一次闪，实现"需两张闪"。
//
// onSettle 职责（runUseFlow 在结算完成后、popFrame 前调用）：
//   出杀次数累加（slash-quota）+ 回合用量 view 同步。

import type { Card } from '../types';
import type { ActionPrompt, GameView } from '../types';
import { applyAtom } from '../create-engine';
import { inAttackRange } from '../distance';
import { viewCanAttack } from '../viewDistance';
import { canSlash, incSlashUsed, isSlashExempted, slashUsed } from '../slash-quota';
import { defaultPlayActive, viewCanSlash } from '../action-active';
import {
  registerCardEffect,
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

/** 杀的生效后效果：对目标角色造成 1 点伤害 */
async function resolveSlash(ctx: ResolveCtx): Promise<void> {
  const { state, source, target, cardId } = ctx;
  const damageType = state.cardMap[cardId]?.damageType;
  await applyAtom(state, {
    type: '造成伤害',
    target,
    amount: 1,
    source,
    cardId,
    damageType,
  });
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
