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
  if (fromPlayer.equipment.进攻马) {
    dist = Math.max(1, dist - 1);
  }

  // 技能距离修正（如马术：马术/距离修正 = -1）
  const 马术距离修正 = fromPlayer.vars['马术/距离修正'];
  if (typeof 马术距离修正 === 'number') {
    dist = Math.max(1, dist + 马术距离修正);
  }

  const toPlayer = getPlayer(state, to);
  if (toPlayer.equipment.防御马) {
    dist += 1;
  }

  return dist;
}

export function getAttackRange(state: GameState, player: string): number {
  const p = getPlayer(state, player);
  if (p.equipment.武器) {
    const card = state.cardMap[p.equipment.武器];
    if (card?.range != null) return card.range;
  }
  return 1;
}

export function isInAttackRange(state: GameState, attacker: string, target: string): boolean {
  return getDistance(state, attacker, target) <= getAttackRange(state, attacker);
}
