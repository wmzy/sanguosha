import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { createRng } from '../../shared/rng';

export function register() {
  registerAtom({
    type: 'reshuffle',
    apply(state: GameState, _atom: Atom & { type: 'reshuffle' }): GameState {
      const discardPile = state.zones.discardPile;
      if (discardPile.length === 0) return state;
      const rng = createRng(state.rngState);
      const shuffled = [...discardPile];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return {
        ...state,
        zones: { deck: [...state.zones.deck, ...shuffled], discardPile: [] },
        rngState: rng.getState(),
      };
    },
    toEvents(state: GameState, _atom: Atom & { type: 'reshuffle' }): AtomEventResult {
      const moved = state.zones.discardPile.length;
      const server = makeServerEvent('reshuffle', { count: moved });
      const owner = makePlayerEvent('reshuffle', { count: moved });
      return [server, new Map(), owner];
    },
  });
}
