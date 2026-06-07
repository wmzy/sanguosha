import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: '设横置',
    apply(state: GameState, atom: Atom & { type: '设横置' }): GameState {
      const target = atom.target as string;
      const chained = atom.chained as boolean;
      return updatePlayer(state, target, () => ({ chained }));
    },
    toEvents(_state: GameState, atom: Atom & { type: '设横置' }): AtomEventResult {
      const target = atom.target as string;
      const chained = atom.chained as boolean;
      const payload: Json = { target, chained };
      const server = makeServerEvent('设横置', payload);
      return [server, new Map(), makePlayerEvent('设横置', payload)];
    },
  });
}
