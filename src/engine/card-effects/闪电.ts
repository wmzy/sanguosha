// 闪电 CardEffect — 延时锦囊·闪电的使用结算。
//
// 闪电的特殊逻辑（移动到下家）在此实现（用户要求在使用牌技能/card-effect 层实现）：
//   判定♠2-9 → 受到 3 点无来源雷电伤害 + 闪电进弃牌堆
//   其他结果 → 闪电传递给下家（下家的判定区）
// 无来源伤害用 source: TARGET_SYSTEM（系统惯例，见 造成伤害 atom）。

import type { Card, ActionPrompt, GameState } from '../types';
import { TARGET_SYSTEM } from '../types';
import { applyAtom } from '../create-engine';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

const TRICK_NAME = '闪电';

/** 判定结果是否触发：黑桃 2~9 */
function isLightningHit(card: Card): boolean {
  if (card.suit !== '♠') return false;
  const rank = card.rank;
  const n =
    rank === 'A'
      ? 1
      : rank === 'J'
        ? 11
        : rank === 'Q'
          ? 12
          : rank === 'K'
            ? 13
            : parseInt(rank, 10);
  return n >= 2 && n <= 9;
}

/** 找下一个判定区没有闪电的存活玩家（从 current 之后按座次环形搜索） */
function findNextRecipient(state: GameState, current: number): number | null {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (current + i) % n;
    const p = state.players[idx];
    if (!p.alive) continue;
    if (p.pendingTricks.some((t) => t.name === TRICK_NAME)) continue;
    return idx;
  }
  return null;
}

/** 闪电的生效后效果：判定 → 命中则伤害+移除，否则传递下家 */
async function resolveLightning(ctx: ResolveCtx): Promise<void> {
  const { state, target, cardId } = ctx;
  await applyAtom(state, { type: '判定', player: target, judgeType: TRICK_NAME });
  const judgeCardId = state.localVars['判定/finalJudgeCardId'] as string | undefined;
  delete state.localVars['判定/finalJudgeCardId'];
  const judgeCard = judgeCardId ? state.cardMap[judgeCardId] : undefined;

  // 保留原 trick 条目引用（实体卡）——传递时复用同一张卡，不丢失实体
  const trickEntry = state.players[target]?.pendingTricks.find((t) => t.name === TRICK_NAME);
  const lightningCard: Card = trickEntry?.card ?? state.cardMap[cardId] ?? judgeCard ?? { id: cardId, name: TRICK_NAME, suit: '♠', color: '黑', rank: 'A', type: '锦囊牌' };

  if (judgeCard && isLightningHit(judgeCard)) {
    // 黑桃 2-9：受到 3 点无来源雷电伤害 + 移除闪电（进弃牌堆）
    await applyAtom(state, {
      type: '造成伤害',
      target,
      amount: 3,
      source: TARGET_SYSTEM,
      damageType: '雷电',
    });
    await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: TRICK_NAME });
  } else {
    // 其他：移除当前玩家闪电，传递给下家
    await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: TRICK_NAME });
    const next = findNextRecipient(state, target);
    if (next !== null) {
      await applyAtom(state, {
        type: '添加延时锦囊',
        player: next,
        trick: { name: TRICK_NAME, source: target, card: lightningCard },
      });
    }
  }
}

const lightningEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'self' },
  delayed: true,
  resolve: resolveLightning,
  prompt: {
    type: 'useCard',
    title: '闪电',
    cardFilter: { filter: (c: Card) => c.name === TRICK_NAME, min: 1, max: 1 },
  } as ActionPrompt,
  label: '闪电',
  style: 'danger',
};

registerCardEffect(TRICK_NAME, lightningEffect);
