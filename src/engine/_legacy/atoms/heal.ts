// @ts-nocheck
import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: '回复体力',
    apply(state: GameState, atom: Atom & { type: '回复体力' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      return updatePlayer(state, target, p => ({
        health: Math.min(p.health + amount, p.maxHealth),
      }));
    },
  });
}
