import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'setChained',
    apply(state: GameState, atom: Atom & { type: 'setChained' }): GameState {
      const target = atom.target as string;
      const chained = atom.chained as boolean;
      return updatePlayer(state, target, () => ({ chained }));
    },
    toEvents(_state: GameState, atom: Atom & { type: 'setChained' }): AtomEventResult {
      const target = atom.target as string;
      const chained = atom.chained as boolean;
      const payload: Json = { target, chained };
      const server = makeServerEvent('setChained', payload);
      return [server, new Map(), makePlayerEvent('setChained', payload)];
    },
  });
}
