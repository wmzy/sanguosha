// 乐不思蜀 CardEffect — 延时锦囊·乐不思蜀的使用结算。
//
// 延迟类锦囊：runUseFlow 置入判定区后暂停（delayed=true），
// 判定阶段由 resumeDelayedSettlement 恢复使用结算中，resolve 执行判定+效果。
//
// 生效后效果（use.md）：先进行判定结算 → 读判定牌花色 → 执行效果 → 移除延时锦囊。
//   判定非♥ → 跳过出牌阶段（加标签，出牌阶段 before-hook 消费）
//   判定♥   → 无效，弃置

import type { Card } from '../types';
import type { ActionPrompt, GameView } from '../types';
import { applyAtom } from '../create-engine';
import { effectiveDistance } from '../distance';
import { viewEffectiveDistance } from '../viewDistance';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 跳过出牌阶段的 tag 名 */
const SKIP_TAG = '乐不思蜀/跳过出牌';

/** 乐不思蜀牌特有校验：距离 1 内的其他角色、判定区无同名 */
function canUseIndulgence(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const target =
    (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
  if (target === undefined) return '目标不合法';
  if (target === ownerId) return '不能对自己使用';
  if (!state.players[target]?.alive) return '目标已死亡';
  if (effectiveDistance(state, ownerId, target) > 1) return '距离太远';
  if (state.players[target].pendingTricks.some((t) => t.name === '乐不思蜀'))
    return '目标判定区已有乐不思蜀';
  return null;
}

/** 乐不思蜀的生效后效果：判定 → 非♥加跳过标签 → 移除延时锦囊 */
async function resolveIndulgence(ctx: ResolveCtx): Promise<void> {
  const { state, target } = ctx;
  // 判定结算：翻牌堆顶 → 改判 → 判定牌进弃牌堆（最终判定牌 ID 记录在 localVars）
  await applyAtom(state, { type: '判定', player: target, judgeType: '乐不思蜀' });
  const judgeCardId = state.localVars['判定/finalJudgeCardId'] as string | undefined;
  delete state.localVars['判定/finalJudgeCardId'];
  const judgeCard = judgeCardId ? state.cardMap[judgeCardId] : undefined;
  if (judgeCard && judgeCard.suit !== '♥') {
    // 非♥：加跳过出牌阶段标签
    await applyAtom(state, { type: '加标签', player: target, tag: SKIP_TAG });
  }
  // 移除延时锦囊（♥时无效弃置，非♥时生效后弃置）
  await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: '乐不思蜀' });
}

const indulgenceEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'distance', dist: 1, min: 1, max: 1 },
  delayed: true,
  canUse: canUseIndulgence,
  resolve: resolveIndulgence,
  prompt: {
    type: 'useCardAndTarget',
    title: '乐不思蜀',
    cardFilter: { filter: (c: Card) => c.name === '乐不思蜀', min: 1, max: 1 },
    targetFilter: {
      min: 1,
      max: 1,
      filter: (view: GameView, t: number) =>
        viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1,
    },
  } as ActionPrompt,
  label: '乐不思蜀',
  style: 'danger',
};

registerCardEffect('乐不思蜀', indulgenceEffect);
