// 闪电 CardEffect — 延时锦囊·闪电的使用结算。
//
// 闪电的特殊逻辑（移动到下家）在此实现（用户要求在使用牌技能/card-effect 层实现）：
//   判定♠2-9 → 受到 3 点无来源雷电伤害 + 闪电进弃牌堆
//   其他结果 → 闪电传递给下家（下家的判定区）
// 无来源伤害用 source: TARGET_SYSTEM（系统惯例，见 扣减体力 atom）。

import type { Card, GameState, PlayerState } from '../../types';
import { TARGET_SYSTEM } from '../../types';
import { applyAtom } from '../../core/apply';
import { runJudgeFlow } from '../../flows/judge';
import { runDamageFlow } from '../../flows/damage';
import { isSpade2to9 } from '../../flows/rank';
import { findNextAlive } from '../../util/player-query';
import type { CardEffect, ResolveCtx } from '../../types';

const TRICK_NAME = '闪电';

/** 判定区是否无闪电（findNextAlive 的候选谓词）。 */
const noLightning = (p: PlayerState): boolean =>
  !p.pendingTricks.some((t) => t.name === TRICK_NAME);

/** 闪电传递给下家：移除当前玩家的闪电，添加到下一个判定区无闪电的存活玩家。
 *  用于：判定非命中（resolveLightning）+ 被无懈可击抵消（onCancelled）。
 *  候选环形搜索含 from 自身兜底（全场他人均不可传时回到自己，原 findNextRecipient 同此）；
 *  findNextAlive 无匹配时同样返回 from（原版此时返回 null=闪电离场，不再回置）——
 *  两种「返回 from」按 from 自身是否仍可持有（存活且判定区无闪电）区分。 */
async function passLightningToNext(state: GameState, from: number, card: Card): Promise<void> {
  await applyAtom(state, { type: '移除延时锦囊', player: from, trickName: TRICK_NAME });
  const next = findNextAlive(state, from, noLightning);
  const self = state.players[from];
  if (next !== from || (self?.alive === true && noLightning(self))) {
    await applyAtom(state, {
      type: '添加延时锦囊',
      player: next,
      trick: { name: TRICK_NAME, source: from, card },
    });
  }
}

/** 闪电实体卡解析（cancelled/resolve 两路径共用）：
 *  判定区 trick 条目(实体卡) → cardMap(使用中的牌) → extra 兜底(仅 resolve 传判定翻出的牌)
 *  → 合成默认。 */
function getLightningCard(state: GameState, target: number, cardId: string, extra?: Card): Card {
  const trickEntry = state.players[target]?.pendingTricks.find((t) => t.name === TRICK_NAME);
  return (
    trickEntry?.card ??
    state.cardMap[cardId] ??
    extra ?? { id: cardId, name: TRICK_NAME, suit: '♠', color: '黑', rank: 'A', type: '锦囊牌' }
  );
}

/** 闪电被无懈可击抵消（判定前）：不判定、不受伤、不弃置，传递给下家。 */
async function onLightningCancelled(state: GameState, target: number, cardId: string): Promise<void> {
  await passLightningToNext(state, target, getLightningCard(state, target, cardId));
}

/** 闪电的生效后效果：判定 → 命中则伤害+移除，否则传递下家 */
async function resolveLightning(ctx: ResolveCtx): Promise<void> {
  const { state, target, cardId } = ctx;
  const judgeCardId = await runJudgeFlow(state, target, TRICK_NAME);
  const judgeCard = judgeCardId ? state.cardMap[judgeCardId] : undefined;

  // 保留原 trick 条目引用（实体卡）——传递时复用同一张卡，不丢失实体
  const lightningCard = getLightningCard(state, target, cardId, judgeCard);

  if (isSpade2to9(judgeCard)) {
    // 黑桃 2-9：受到 3 点无来源雷电伤害 + 移除闪电（进弃牌堆）
    await runDamageFlow(state, TARGET_SYSTEM, target, 3, undefined, '雷电');
    await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: TRICK_NAME });
  } else {
    // 其他：传递给下家
    await passLightningToNext(state, target, lightningCard);
  }
}

export const lightningEffect: CardEffect = {
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
  },
  label: '闪电',
  style: 'danger',
};
