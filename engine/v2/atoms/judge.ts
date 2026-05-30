import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';
import type { Card } from '../../../shared/types';

type Suit = Card['suit'];
const redSuits: Suit[] = ['♥', '♦'];

registerAtom({
  type: 'judge',
  apply(state: GameState, atom: Atom & { type: 'judge' }) {
    const player = atom.player as string;
    const cardId = state.zones.deck[state.zones.deck.length - 1];
    const card = state.cardMap[cardId] as Card;
    const result: 'red' | 'black' = redSuits.includes(card.suit) ? 'red' : 'black';

    let s: GameState = {
      ...state,
      zones: {
        ...state.zones,
        deck: state.zones.deck.slice(0, -1),
        discardPile: [...state.zones.discardPile, cardId],
      },
    };

    if (atom.varKey) {
      s = updatePlayer(s, player, p => ({
        vars: { ...p.vars, [atom.varKey!]: result },
      }));
    }

    return s;
  },
  toEvents(state: GameState, atom: Atom & { type: 'judge' }): AtomEventResult {
    const player = atom.player as string;
    const cardId = state.zones.deck[state.zones.deck.length - 1];
    const card = state.cardMap[cardId] as Card;
    const result: 'red' | 'black' = redSuits.includes(card.suit) ? 'red' : 'black';
    const payload = { player, cardId, result, suit: card.suit, rank: card.rank };
    const server = makeServerEvent('judge', payload);
    return [server, new Map(), makePlayerEvent('judge', payload)];
  },
});
