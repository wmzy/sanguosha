// 合法性检测 helper（对齐文档 condition.md 三条件）。
//
// 一张牌能被使用的条件：
//   1. 不受技能效果影响不能使用此牌（禁用 tag）
//   2. 使用次数未达上限（仅杀，走 slash-quota）
//   3. 额定目标数 > 0（全场有至少一个合法额定目标）
//
// 检测合法性 = 距离合法性 + 选择目标合法性。

import type { GameState, Json } from '../types';
import { effectiveDistance, inAttackRange } from '../distance';
import { canSlash } from '../slash-quota';
import { validateUseCard } from '../skill';
import type { CardTargetSpec } from './registry';
import { getCardEffect } from './registry';

/** 检查 ownerId 是否被禁止使用此牌（condition.md 条件1）。
 *  当前通过 player.tags 检查通用禁用标记。
 *  义绝的 '义绝/禁出牌' 标记已覆盖此路径。 */
function isCardBanned(state: GameState, ownerId: number, _cardName: string): boolean {
  const player = state.players[ownerId];
  if (!player) return false;
  // 义绝：禁出牌标记阻止使用/打出任何需要出牌的 prompt
  if (player.tags.includes('义绝/禁出牌')) return true;
  return false;
}

/** 检查使用次数（condition.md 条件2，仅杀）。
 *  从 params 取 cardId 传给 canSlash，以支持 per-card 出杀次数豁免（SlashExemptor）。 */
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

/** 判断 target 是否为 ownerId 使用 cardName 的合法目标（condition.md 合法性检测）。
 *  检测距离合法性 + 选择目标合法性。 */
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
    // 自己作为目标：只有 target.kind='self' 或 'allPlayers' 时合法；
    // kind='wounded' 时需自己已受伤。
    if (spec.kind === 'self' || spec.kind === 'allPlayers') return true;
    if (spec.kind === 'wounded') {
      const p = state.players[ownerId];
      return !!p && p.health < p.maxHealth;
    }
    return false;
  }

  const targetPlayer = state.players[target];
  if (!targetPlayer?.alive) return false;

  switch (spec.kind) {
    case 'none':
    case 'self':
      return false;
    case 'inAttackRange':
      return inAttackRange(state, ownerId, target);
    case 'distance':
      return effectiveDistance(state, ownerId, target) <= spec.dist;
    case 'allOthers':
    case 'allPlayers':
    case 'other':
      return true;
    case 'wounded':
      return targetPlayer.health < targetPlayer.maxHealth;
    default:
      return false;
  }
}

/** 遍历全场，找到所有合法的额定目标（condition.md 条件3）。
 *  用于检查"额定目标数 > 0"。 */
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

/** 统一合法性检测（condition.md 三条件）。
 *  返回 null=通过，字符串=拒绝理由。
 *
 *  检查顺序：
 *    基础 → 禁用 → 次数 → 合法目标数 → 牌特有校验 */
export function validateCardUse(
  state: GameState,
  ownerId: number,
  params: Record<string, Json>,
  cardName: string,
): string | null {
  // 基础检查：自己回合、出牌阶段、无阻塞 pending、存活、手牌中有牌、牌名匹配
  const base = validateUseCard(state, ownerId, params, { cardName });
  if (base) return base;

  // 条件1：禁用检测
  if (isCardBanned(state, ownerId, cardName)) return '你不能使用此牌';

  // 条件2：次数限制（仅杀）
  const limit = checkUsageLimit(state, ownerId, cardName, params);
  if (limit) return limit;

  // 条件3：合法目标数 > 0（有目标要求的牌）
  const effect = getCardEffect(cardName);
  if (!effect) return `${cardName} 尚未注册 CardEffect`;
  if (effect.target.kind !== 'none' && effect.target.kind !== 'self') {
    const legalTargets = findLegalTargets(state, ownerId, cardName);
    if (legalTargets.length === 0) return '没有合法目标';
  }

  // 牌特有校验
  if (effect.canUse) {
    const customErr = effect.canUse(state, ownerId, params);
    if (customErr) return customErr;
  }

  return null;
}
