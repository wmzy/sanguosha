import type { GameState, Player } from '../shared/types';

export function getDistance(game: GameState, from: string, to: string): number {
  const alivePlayers = game.players.filter(p => p.alive);
  const n = alivePlayers.length;
  if (n < 2) return 1;

  const fromIdx = alivePlayers.findIndex(p => p.name === from);
  const toIdx = alivePlayers.findIndex(p => p.name === to);
  if (fromIdx === -1 || toIdx === -1) return Infinity;

  const clockwise = (toIdx - fromIdx + n) % n;
  const counterClockwise = (fromIdx - toIdx + n) % n;
  let distance = Math.min(clockwise, counterClockwise);

  const fromPlayer = game.players.find(p => p.name === from)!;
  if (fromPlayer.equipment.horseMinus) distance -= 1;

  const toPlayer = game.players.find(p => p.name === to)!;
  if (toPlayer.equipment.horsePlus) distance += 1;

  return Math.max(distance, 1);
}

export function getAttackRange(player: Player): number {
  if (player.equipment.weapon?.range) {
    return player.equipment.weapon.range;
  }
  return 1;
}

export function isInAttackRange(game: GameState, attacker: string, target: string): boolean {
  const attackerPlayer = game.players.find(p => p.name === attacker);
  if (!attackerPlayer) return false;
  const range = getAttackRange(attackerPlayer);
  const distance = getDistance(game, attacker, target);
  return distance <= range;
}
