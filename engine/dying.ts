import type { GameState } from '../shared/types';

export interface DyingOptions {
  canSelfSave: boolean;
  savers: string[];
}

export function checkDying(health: number): boolean {
  return health <= 0;
}

export function getDyingOptions(game: GameState, dyingPlayer: string): DyingOptions {
  const savers: string[] = [];
  for (const player of game.players) {
    if (!player.alive) continue;
    const hasPeach = player.hand.some(c => c.name === '桃');
    if (hasPeach) {
      savers.push(player.name);
    }
  }
  const canSelfSave = savers.includes(dyingPlayer);
  return { canSelfSave, savers };
}

export function applyDying(game: GameState, playerName: string): GameState {
  return {
    ...game,
    players: game.players.map(p =>
      p.name === playerName ? { ...p, health: 0, alive: false } : p,
    ),
  };
}

export function applyPeachSave(game: GameState, saverName: string, dyingName: string): GameState {
  const isSelfSave = saverName === dyingName;
  return {
    ...game,
    players: game.players.map(p => {
      if (isSelfSave && p.name === dyingName) {
        const idx = p.hand.findIndex(c => c.name === '桃');
        const newHand = idx >= 0 ? [...p.hand.slice(0, idx), ...p.hand.slice(idx + 1)] : p.hand;
        return { ...p, health: 1, alive: true, hand: newHand };
      }
      if (p.name === dyingName) {
        return { ...p, health: 1, alive: true };
      }
      if (p.name === saverName) {
        const idx = p.hand.findIndex(c => c.name === '桃');
        if (idx >= 0) {
          const newHand = [...p.hand];
          newHand.splice(idx, 1);
          return { ...p, hand: newHand };
        }
      }
      return p;
    }),
  };
}
