import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'discard',
    apply(state: GameState, atom: Atom & { type: 'discard' }): GameState {
      const player = atom.player as string;
      const cardIds = atom.cardIds as string[];
      const cardIdSet = new Set(cardIds);
      return {
        ...updatePlayer(state, player, p => ({
          hand: p.hand.filter(id => !cardIdSet.has(id)),
        })),
        zones: {
          ...state.zones,
          discardPile: [...state.zones.discardPile, ...cardIds],
        },
      };
    },
    toEvents(_state: GameState, atom: Atom & { type: 'discard' }): AtomEventResult {
      const player = atom.player as string;
      const cardIds = atom.cardIds as string[];
      const payload: Json = { player, cardIds };
      const server = makeServerEvent('cardsDiscarded', payload);
      return [server, new Map(), makePlayerEvent('cardsDiscarded', payload)];
    },
  });
}
