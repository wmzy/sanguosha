// 合法性检测 helper（对齐文档 condition.md 三条件）。
// 从原 core/card-effect/validate.ts 移植,路径调整后的新位置。
import type { GameState, Json, CardTargetSpec } from '../../types';
import { effectiveDistance, inAttackRange } from '../../rules/distance';
import { canSlash } from '../../rules/slash-quota';
import { validateUseCard } from '../../core/skill';
import { alivePlayersClockwiseFrom } from '../../util/player-query';
import { hasNoDistanceLimit } from './_distanceOne';
import { getCardEffect } from '.';

export function isCardBanned(state: GameState, ownerId: number, _cardName: string): boolean {
  const player = state.players[ownerId];
  if (!player) return false;
  if (player.tags.includes('义绝/禁出牌')) return true;
  // 往烈(陈到):发动不可响应后本阶段不能再使用牌(turn-scoped,回合结束自动清空)
  if (state.turn.vars['往烈/禁出牌'] === ownerId) return true;
  return false;
}

function checkUsageLimit(
  state: GameState,
  ownerId: number,
  cardName: string,
  params: Record<string, Json>,
): string | null {
  if (cardName === '杀') {
    const cardId = params.cardId as string | undefined;
    if (!canSlash(state, ownerId, cardId)) return '出杀次数已达上限';
  }
  return null;
}

export function isLegalTarget(
  state: GameState,
  ownerId: number,
  cardName: string,
  target: number,
  cardId?: string,
): boolean {
  const effect = getCardEffect(cardName);
  if (!effect) return false;
  const spec: CardTargetSpec = effect.target;

  if (target === ownerId) {
    if (spec.kind === 'self' || spec.kind === 'allPlayers' || spec.kind === 'any') return true;
    if (spec.kind === 'wounded') {
      const p = state.players[ownerId];
      return !!p && p.health < p.maxHealth;
    }
    return false;
  }

  const targetPlayer = state.players[target];
  if (!targetPlayer?.alive) return false;

  switch (spec.kind) {
    case 'effect':
    case 'self':
      return false;
    case 'inAttackRange':
      return inAttackRange(state, ownerId, target);
    case 'distance': {
      // 奇才(无距离限制)豁免判据与 cards/_distanceOne 同源
      if (hasNoDistanceLimit(state, ownerId)) return true;
      return effectiveDistance(state, ownerId, target, cardId) <= spec.dist;
    }
    case 'allOthers':
    case 'allPlayers':
    case 'other':
    case 'any':
      return true;
    case 'wounded':
      return targetPlayer.health < targetPlayer.maxHealth;
    default:
      return false;
  }
}

export function computeAutoTargets(
  state: GameState,
  ownerId: number,
  cardName: string,
): number[] {
  const effect = getCardEffect(cardName);
  if (!effect) return [];
  const spec = effect.target;
  if (spec.kind !== 'allOthers' && spec.kind !== 'allPlayers') return [];
  // 多目标结算顺序:从使用者起逆时针(allOthers 不含使用者,allPlayers 含使用者时自己居首)。
  return alivePlayersClockwiseFrom(state, ownerId, { includeSelf: spec.kind === 'allPlayers' });
}

export function findLegalTargets(
  state: GameState,
  ownerId: number,
  cardName: string,
  cardId?: string,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < state.players.length; i++) {
    if (isLegalTarget(state, ownerId, cardName, i, cardId)) result.push(i);
  }
  return result;
}

export function validateCardUse(
  state: GameState,
  ownerId: number,
  params: Record<string, Json>,
  cardName: string,
  mode: 'play' | 'forced' = 'play',
): string | null {
  if (mode === 'play') {
    const base = validateUseCard(state, ownerId, params, { cardName });
    if (base) return base;
  } else {
    const cardId = params.cardId as string | undefined;
    if (!cardId) return 'cardId required';
    const card = state.cardMap[cardId];
    if (!card) return '牌不存在';
    if (card.name !== cardName) return `不是${cardName}`;
  }

  if (isCardBanned(state, ownerId, cardName)) return '你不能使用此牌';

  if (mode === 'play') {
    const limit = checkUsageLimit(state, ownerId, cardName, params);
    if (limit) return limit;
  }

  const effect = getCardEffect(cardName);
  if (!effect) return `${cardName} 尚未注册 CardEffect`;
  if (effect.target.kind !== 'self' && effect.target.kind !== 'effect') {
    const cardId = params.cardId as string | undefined;
    const legalTargets = findLegalTargets(state, ownerId, cardName, cardId);
    if (legalTargets.length === 0) return '没有合法目标';
  }

  if (effect.canUse) {
    const customErr = effect.canUse(state, ownerId, params);
    if (customErr) return customErr;
  }

  return null;
}
