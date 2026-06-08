import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';

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
  });
}
