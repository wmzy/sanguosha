import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';
import { createRng } from '../../../shared/rng';

function reshuffleIfNeeded(state: GameState, needed: number): GameState {
  if (state.zones.deck.length >= needed) return state;

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
    zones: {
      deck: [...state.zones.deck, ...shuffled],
      discardPile: [],
    },
    rngState: state.rngState + Math.max(0, discardPile.length - 1),
  };
}

export function register() {
  registerAtom({
    type: 'draw',
    apply(state: GameState, atom: Atom & { type: 'draw' }): GameState {
      const player = atom.player as string;
      const count = atom.count as number;
      const s = reshuffleIfNeeded(state, count);
      const drawn = s.zones.deck.slice(0, count);
      const remaining = s.zones.deck.slice(count);
      return updatePlayer(
        { ...s, zones: { ...s.zones, deck: remaining } },
        player,
        p => ({ hand: [...p.hand, ...drawn] }),
      );
    },
    toEvents(state: GameState, atom: Atom & { type: 'draw' }): AtomEventResult {
      const player = atom.player as string;
      const count = atom.count as number;
      const drawn = state.zones.deck.slice(0, count);
      const actualCount = drawn.length;
      const server = makeServerEvent('draw', { player, count: actualCount, cards: drawn });
      const ownerEvent = makePlayerEvent('draw', { player, count: actualCount, cards: drawn });
      const defaultEvent = makePlayerEvent('draw', { player, count: actualCount });
      return [server, new Map([[player, ownerEvent]]), defaultEvent];
    },
  });
}
