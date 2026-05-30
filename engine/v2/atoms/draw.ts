import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

registerAtom({
  type: 'draw',
  apply(state: GameState, atom: Atom & { type: 'draw' }): GameState {
    const player = atom.player as string;
    const count = atom.count as number;
    const drawn = state.zones.deck.slice(0, count);
    const remaining = state.zones.deck.slice(count);
    return updatePlayer(
      { ...state, zones: { ...state.zones, deck: remaining } },
      player,
      p => ({ hand: [...p.hand, ...drawn] }),
    );
  },
  toEvents(state: GameState, atom: Atom & { type: 'draw' }): AtomEventResult {
    const player = atom.player as string;
    const count = atom.count as number;
    const drawn = state.zones.deck.slice(0, count);
    const server = makeServerEvent('draw', { player, count, cards: drawn });
    const ownerEvent = makePlayerEvent('draw', { player, count, cards: drawn });
    const defaultEvent = makePlayerEvent('draw', { player, count });
    return [server, new Map([[player, ownerEvent]]), defaultEvent];
  },
});
