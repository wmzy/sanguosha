import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

export function register() {
  registerAtom({
    type: 'incrementKills',
    apply(state: GameState, _atom: Atom & { type: 'incrementKills' }) {
      return {
        ...state,
        turn: {
          ...state.turn,
          killsPlayed: state.turn.killsPlayed + 1,
        },
      };
    },
    toEvents(state: GameState, _atom: Atom & { type: 'incrementKills' }): AtomEventResult {
      const server = makeServerEvent('incrementKills', {
        killsPlayed: state.turn.killsPlayed + 1,
      });
      return [server, new Map(), null];
    },
  });
}
