// 兵粮寸断 CardEffect — 延时锦囊·兵粮寸断的使用结算。
//
// 与乐不思蜀对称——差异：判定花色（♣ vs ♥），跳过阶段（摸牌 vs 出牌）。
//   判定非♣ → 跳过摸牌阶段
//   判定♣   → 无效，弃置

import type { Card } from '../types';
import type { GameView } from '../types';
import { applyAtom } from '../index';
import { runJudgeFlow } from '../judge-flow';
import { effectiveDistance } from '../rules/distance';
import { viewEffectiveDistance } from '../rules/viewDistance';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';
import { registerDelayedTrick } from '../card-effect/delayed-trick-registry';

/** 跳过摸牌阶段的 tag 名 */
const SKIP_TAG = '兵粮寸断/跳过摸牌';

function canUseSupplyShortage(
  state: import('../types').GameState,
  ownerId: number,
  params: Record<string, import('../types').Json>,
): string | null {
  const target =
    (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
  if (target === undefined) return '目标不合法';
  if (target === ownerId) return '不能对自己使用';
  if (!state.players[target]?.alive) return '目标已死亡';
  // 距离检查:isLegalTarget 统一处理(含奇才豁免),canUse 也需检查具体目标
  const ignoreDistance = !!state.players[ownerId]?.tags.includes('奇才/无距离限制');
  if (!ignoreDistance && effectiveDistance(state, ownerId, target) > 1) return '距离太远';
  if (state.players[target].pendingTricks.some((t) => t.name === '兵粮寸断'))
    return '目标判定区已有兵粮寸断';
  return null;
}

/** 兵粮寸断的生效后效果：判定 → 非♣加跳过标签 → 移除延时锦囊 */
async function resolveSupplyShortage(ctx: ResolveCtx): Promise<void> {
  const { state, target } = ctx;
  await runJudgeFlow(state, target, '兵粮寸断');
  const judgeCardId = state.localVars['判定/finalJudgeCardId'] as string | undefined;
  delete state.localVars['判定/finalJudgeCardId'];
  const judgeCard = judgeCardId ? state.cardMap[judgeCardId] : undefined;
  if (judgeCard && judgeCard.suit !== '♣') {
    // 非♣：加跳过摸牌阶段标签
    await applyAtom(state, { type: '加标签', player: target, tag: SKIP_TAG });
  }
  // 移除延时锦囊
  await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: '兵粮寸断' });
}

const supplyShortageEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'distance', dist: 1, min: 1, max: 1 },
  delayed: true,
  cancelledBy: { cardName: '无懈可击', broadcast: true },
  canUse: canUseSupplyShortage,
  resolve: resolveSupplyShortage,
  prompt: {
    type: 'useCardAndTarget',
    title: '兵粮寸断',
    cardFilter: { filter: (c: Card) => c.name === '兵粮寸断', min: 1, max: 1 },
    targetFilter: {
      min: 1,
      max: 1,
      filter: (view: GameView, t: number) => {
        if (t === view.currentPlayerIndex) return false;
        const tp = view.players[t];
        if (!tp || tp.alive === false) return false;
        if (view.players[view.currentPlayerIndex]?.tags?.includes('奇才/无距离限制')) return true;
        return viewEffectiveDistance(view.players, view.currentPlayerIndex, t) <= 1;
      },
    },
  },
  label: '兵粮寸断',
  style: 'danger',
};

registerCardEffect('兵粮寸断', supplyShortageEffect);

// 自注册延时锦囊:判定非♣生效后跳过摸牌阶段
registerDelayedTrick({ name: '兵粮寸断', skipPhase: { tag: SKIP_TAG, phase: '摸牌' } });
