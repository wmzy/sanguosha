import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';
import { createRng } from '../../shared/rng';

export function register() {
  registerAtom({
    type: '重洗',
    apply(state: GameState, _atom: Atom & { type: '重洗' }): GameState {
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
  });
}
