import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';

export function register() {
  registerAtom({
    type: '击杀',
    apply(state: GameState, atom: Atom & { type: '击杀' }) {
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
      };
    },
    toEvents(state: GameState, atom: Atom & { type: '击杀' }): AtomEventResult {
      const player = atom.player as string;
      const source = atom.source as string | undefined;
      const payload: Json = { player, ...(source ? { source } : {}) };
      const server = makeServerEvent('击杀', payload);
      return [server, new Map(), makePlayerEvent('击杀', payload)];
    },
  });
}
