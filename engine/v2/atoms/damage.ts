import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'damage',
    apply(state: GameState, atom: Atom & { type: 'damage' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      return updatePlayer(state, target, p => ({
        health: p.health - amount,
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'damage' }): AtomEventResult {
      const target = atom.target as string;
      const amount = atom.amount as number;
      const source = atom.source as string | undefined;
      const cardId = atom.cardId as string | undefined;
      const payload: Json = { target, amount, ...(source ? { source } : {}), ...(cardId ? { cardId } : {}) };
      const server = makeServerEvent('damage', payload);
      return [server, new Map(), makePlayerEvent('damage', payload)];
    },
  });
}
