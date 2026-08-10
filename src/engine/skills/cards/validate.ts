// 合法性检测 helper（对齐文档 condition.md 三条件）。
// 从原 core/card-effect/validate.ts 移植,路径调整后的新位置。
import type { GameState, Json, CardTargetSpec } from '../../types';
import { effectiveDistance, inAttackRange } from '../../rules/distance';
import { canSlash } from '../../rules/slash-quota';
import { validateUseCard } from '../../core/skill';
import { getCardEffect } from '.';

export function isCardBanned(state: GameState, ownerId: number, _cardName: string): boolean {
  const player = state.players[ownerId];
  if (!player) return false;
  if (player.tags.includes('义绝/禁出牌')) return true;
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
      if (state.players[ownerId]?.tags.includes('奇才/无距离限制')) return true;
      return effectiveDistance(state, ownerId, target) <= spec.dist;
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
  const alive = state.players.filter((p) => p.alive);
  const n = alive.length;
  if (n === 0) return [];
  const fromPos = alive.findIndex((p) => p.index === ownerId);
  if (fromPos < 0) return alive.map((p) => p.index);
  const result: number[] = [];
  const start = spec.kind === 'allOthers' ? 1 : 0;
  for (let i = start; i < n; i++) {
    result.push(alive[(fromPos + i) % n].index);
  }
  return result;
}

export function findLegalTargets(
  state: GameState,
  ownerId: number,
  cardName: string,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < state.players.length; i++) {
    if (isLegalTarget(state, ownerId, cardName, i)) result.push(i);
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
    const legalTargets = findLegalTargets(state, ownerId, cardName);
    if (legalTargets.length === 0) return '没有合法目标';
  }

  if (effect.canUse) {
    const customErr = effect.canUse(state, ownerId, params);
    if (customErr) return customErr;
  }

  return null;
}
