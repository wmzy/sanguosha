import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'loseHealth',
    apply(state: GameState, atom: Atom & { type: 'loseHealth' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      if (amount <= 0) return state;
      return updatePlayer(state, target, p => ({
        health: Math.max(0, p.health - amount),
      }));
    },
    toEvents(_state: GameState, atom: Atom & { type: 'loseHealth' }): AtomEventResult {
      const target = atom.target as string;
      const amount = atom.amount as number;
      const payload: Json = { target, amount };
      const server = makeServerEvent('loseHealth', payload);
      return [server, new Map(), makePlayerEvent('loseHealth', payload)];
    },
  });
}
