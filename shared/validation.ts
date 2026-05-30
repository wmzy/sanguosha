/**
 * shared/validation.ts — 前端可用的验证函数
 *
 * 基于 ClientGameState（有限信息）进行保守验证。
 * 逻辑与 engine/v2/validate.ts 对齐，但仅使用客户端可见的数据。
 */

import type { ClientGameState } from './protocol';
import type { Card } from './types';

export function canPlayCard(state: ClientGameState, cardId: string): boolean {
  const selfPlayer = state.players[state.self];
  if (!selfPlayer || !selfPlayer.alive) return false;

  const card = selfPlayer.hand.find((c) => c.id === cardId);
  if (!card) return false;

  if (state.phase !== '出牌') return false;
  if (state.currentPlayer !== state.self) return false;

  switch (card.name) {
    case '杀':
      return state.turn.killsPlayed < 1;
    case '闪':
      return false;
    case '桃':
      return selfPlayer.health < selfPlayer.maxHealth;
    default:
      break;
  }

  if (card.type === '装备牌') return true;

  if (card.type === '锦囊牌') {
    const targets = getValidTargets(state, card.name);
    return targets.length > 0 || isSelfTargetTrick(card.name);
  }

  return true;
}

export function getValidTargets(state: ClientGameState, cardName: string): string[] {
  const selfName = state.self;
  const selfPlayer = state.players[selfName];
  if (!selfPlayer || !selfPlayer.alive) return [];

  const targets: string[] = [];

  switch (cardName) {
    case '杀': {
      for (const [name, player] of Object.entries(state.players)) {
        if (name === selfName || !player.alive) continue;
        targets.push(name);
      }
      break;
    }
    case '桃':
      break;
    case '过河拆桥':
    case '顺手牵羊':
    case '决斗':
    case '乐不思蜀':
    case '兵粮寸断': {
      for (const [name, player] of Object.entries(state.players)) {
        if (name === selfName || !player.alive) continue;
        targets.push(name);
      }
      break;
    }
    default:
      break;
  }

  return targets;
}

export function canUseSkill(state: ClientGameState, _skillId: string): boolean {
  if (state.phase !== '出牌') return false;
  if (state.currentPlayer !== state.self) return false;

  const selfPlayer = state.players[state.self];
  if (!selfPlayer || !selfPlayer.alive) return false;

  return true;
}

function isSelfTargetTrick(cardName: string): boolean {
  return cardName === '无中生有' || cardName === '闪电';
}
