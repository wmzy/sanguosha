import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
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
    toEvents(_state: GameState, atom: Atom & { type: '失去体力' }): AtomEventResult {
      const target = atom.target as string;
      const amount = atom.amount as number;
      const payload: Json = { target, amount };
      const server = makeServerEvent('失去体力', payload);
      return [server, new Map(), makePlayerEvent('失去体力', payload)];
    },
  });
}
