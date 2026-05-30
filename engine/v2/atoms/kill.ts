import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';

export function register() {
  registerAtom({
    type: 'kill',
    apply(state: GameState, atom: Atom & { type: 'kill' }) {
      const player = atom.player as string;
      return {
        ...state,
        players: {
          ...state.players,
          [player]: {
            ...state.players[player],
            info: { ...state.players[player].info, alive: false },
          },
        },
        playerOrder: state.playerOrder.filter(name => name !== player),
      };
    },
    toEvents(state: GameState, atom: Atom & { type: 'kill' }): AtomEventResult {
      const player = atom.player as string;
      const source = atom.source as string | undefined;
      const payload: Json = { player, ...(source ? { source } : {}) };
      const server = makeServerEvent('kill', payload);
      return [server, new Map(), makePlayerEvent('kill', payload)];
    },
  });
}
