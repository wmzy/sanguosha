import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: '失去体力',
    apply(state: GameState, atom: Atom & { type: '失去体力' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      if (amount <= 0) return state;
      return updatePlayer(state, target, p => ({
        health: Math.max(0, p.health - amount),
      }));
    },
  });
}
