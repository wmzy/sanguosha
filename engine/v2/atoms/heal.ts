import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'heal',
    apply(state: GameState, atom: Atom & { type: 'heal' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      return updatePlayer(state, target, p => ({
        health: Math.min(p.health + amount, p.maxHealth),
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'heal' }): AtomEventResult {
      const target = atom.target as string;
      const amount = atom.amount as number;
      const source = atom.source as string | undefined;
      const payload: Json = { target, amount, ...(source ? { source } : {}) };
      const server = makeServerEvent('heal', payload);
      return [server, new Map(), makePlayerEvent('heal', payload)];
    },
  });
}
