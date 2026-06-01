import type { GameState } from './types';
import { getPlayer } from './state';

export function getDistance(state: GameState, from: string, to: string): number {
  if (from === to) return 0;

  const alive = state.playerOrder.filter(name => state.players[name].info.alive);
  const fromIdx = alive.indexOf(from);
  const toIdx = alive.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return Infinity;

  const total = alive.length;
  const clockwise = (toIdx - fromIdx + total) % total;
  const counterClockwise = (fromIdx - toIdx + total) % total;
  let dist = Math.min(clockwise, counterClockwise);

  const fromPlayer = getPlayer(state, from);
  if (fromPlayer.equipment.horseMinus) {
    dist = Math.max(1, dist - 1);
  }

  // 技能距离修正（如马术：distanceBonus = -1）
  const distanceBonus = fromPlayer.vars['distanceBonus'];
  if (typeof distanceBonus === 'number') {
    dist = Math.max(1, dist + distanceBonus);
  }

  const toPlayer = getPlayer(state, to);
  if (toPlayer.equipment.horsePlus) {
    dist += 1;
  }

  return dist;
}

export function getAttackRange(state: GameState, player: string): number {
  const p = getPlayer(state, player);
  if (p.equipment.weapon) {
    const card = state.cardMap[p.equipment.weapon];
    if (card?.range != null) return card.range;
  }
  return 1;
}

export function isInAttackRange(state: GameState, attacker: string, target: string): boolean {
  return getDistance(state, attacker, target) <= getAttackRange(state, attacker);
}
