import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';
import { updatePlayer } from '../state';
import { createRng } from '../../../shared/rng';

export function register() {
  registerAtom({
    type: 'discardRandom',
    apply(state: GameState, atom: Atom & { type: 'discardRandom'; player: string; count: number; from: 'hand' | 'equipment' }) {
      const player = atom.player;
      const count = atom.count;
      const from = atom.from;
      const p = state.players[player];
      if (!p) return state;

      if (from === 'hand') {
        const rng = createRng(state.rngState);
        const hand = [...p.hand];
        const discarded: string[] = [];
        for (let i = 0; i < count && hand.length > 0; i++) {
          const idx = rng.nextInt(hand.length);
          discarded.push(hand.splice(idx, 1)[0]);
        }
        return {
          ...updatePlayer(state, player, _p => ({ hand })),
          zones: { ...state.zones, discardPile: [...state.zones.discardPile, ...discarded] },
          rngState: state.rngState + count,
        };
      }

      return state;
    },
    toEvents(state: GameState, atom: Atom & { type: 'discardRandom'; player: string; count: number; from: 'hand' | 'equipment' }): AtomEventResult {
      const player = atom.player;
      const count = atom.count;
      const from = atom.from;
      const server = makeServerEvent('discardRandom', { player, count, from });
      return [server, new Map(), server] as const;
    },
  });
}
