// 闪电 CardEffect — 延时锦囊·闪电的使用结算。
//
// 闪电的特殊逻辑（移动到下家）在此实现（用户要求在使用牌技能/card-effect 层实现）：
//   判定♠2-9 → 受到 3 点无来源雷电伤害 + 闪电进弃牌堆
//   其他结果 → 闪电传递给下家（下家的判定区）
// 无来源伤害用 source: TARGET_SYSTEM（系统惯例，见 造成伤害 atom）。

import type { Card, ActionPrompt, GameState } from '../types';
import { TARGET_SYSTEM } from '../types';
import { applyAtom } from '../create-engine';
import { runJudgeFlow } from '../judge-flow';
import { runDamageFlow } from '../damage-flow';
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

/** 闪电传递给下家：移除当前玩家的闪电，添加到下一个判定区无闪电的存活玩家。
 *  用于：判定非命中（resolveLightning）+ 被无懈可击抵消（onCancelled）。 */
async function passLightningToNext(state: GameState, from: number, card: Card): Promise<void> {
  await applyAtom(state, { type: '移除延时锦囊', player: from, trickName: TRICK_NAME });
  const next = findNextRecipient(state, from);
  if (next !== null) {
    await applyAtom(state, {
      type: '添加延时锦囊',
      player: next,
      trick: { name: TRICK_NAME, source: from, card },
    });
  }
}

/** 闪电被无懈可击抵消（判定前）：不判定、不受伤、不弃置，传递给下家。 */
async function onLightningCancelled(state: GameState, target: number, cardId: string): Promise<void> {
  const trickEntry = state.players[target]?.pendingTricks.find((t) => t.name === TRICK_NAME);
  const card: Card =
    trickEntry?.card ??
    state.cardMap[cardId] ??
    { id: cardId, name: TRICK_NAME, suit: '♠', color: '黑', rank: 'A', type: '锦囊牌' };
  await passLightningToNext(state, target, card);
}

/** 闪电的生效后效果：判定 → 命中则伤害+移除，否则传递下家 */
async function resolveLightning(ctx: ResolveCtx): Promise<void> {
  const { state, target, cardId } = ctx;
  await runJudgeFlow(state, target, TRICK_NAME);
  const judgeCardId = state.localVars['判定/finalJudgeCardId'] as string | undefined;
  delete state.localVars['判定/finalJudgeCardId'];
  const judgeCard = judgeCardId ? state.cardMap[judgeCardId] : undefined;

  // 保留原 trick 条目引用（实体卡）——传递时复用同一张卡，不丢失实体
  const trickEntry = state.players[target]?.pendingTricks.find((t) => t.name === TRICK_NAME);
  const lightningCard: Card =
    trickEntry?.card ??
    state.cardMap[cardId] ??
    judgeCard ?? {
      id: cardId,
      name: TRICK_NAME,
      suit: '♠',
      color: '黑',
      rank: 'A',
      type: '锦囊牌',
    };

  if (judgeCard && isLightningHit(judgeCard)) {
    // 黑桃 2-9：受到 3 点无来源雷电伤害 + 移除闪电（进弃牌堆）
    await runDamageFlow(state, TARGET_SYSTEM, target, 3, undefined, '雷电');
    await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: TRICK_NAME });
  } else {
    // 其他：传递给下家
    await passLightningToNext(state, target, lightningCard);
  }
}

const lightningEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'self' },
  delayed: true,
  cancelledBy: { cardName: '无懈可击', broadcast: true },
  resolve: resolveLightning,
  onCancelled: onLightningCancelled,
  prompt: {
    type: 'useCard',
    title: '闪电',
    cardFilter: { filter: (c: Card) => c.name === TRICK_NAME, min: 1, max: 1 },
  } as ActionPrompt,
  label: '闪电',
  style: 'danger',
};

registerCardEffect(TRICK_NAME, lightningEffect);
