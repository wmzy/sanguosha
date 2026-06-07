import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { createRng } from '../../shared/rng';

export function register() {
  registerAtom({
    type: '洗牌',
    apply(state: GameState, _atom: Atom & { type: '洗牌' }): GameState {
      const deck = state.zones.deck;
      if (deck.length <= 1) return state;
      const rng = createRng(state.rngState);
      const shuffled = [...deck];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return { ...state, zones: { ...state.zones, deck: shuffled }, rngState: rng.getState() };
    },
    toEvents(_state, _atom) {
      const server = makeServerEvent('洗牌', {});
      return [server, new Map(), makePlayerEvent('洗牌', {})];
    },
  });
}
