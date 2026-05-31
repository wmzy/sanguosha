import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';
import type { Card } from '../../../shared/types';

type Suit = Card['suit'];
const redSuits: Suit[] = ['♥', '♦'];

const FALLBACK_JUDGE_RESULT: 'red' | 'black' = 'black';

function ensureDeckHasCards(state: GameState): GameState {
  if (state.zones.deck.length > 0) return state;
  if (state.zones.discardPile.length === 0) return state;
  return {
    ...state,
    zones: {
      deck: [...state.zones.discardPile],
      discardPile: [],
    },
  };
}

function drawJudgeCard(state: GameState): { cardId: string | null; suit: Suit; rank: string; result: 'red' | 'black' } {
  if (state.zones.deck.length === 0) {
    return { cardId: null, suit: '♣', rank: '', result: FALLBACK_JUDGE_RESULT };
  }
  const cardId = state.zones.deck[state.zones.deck.length - 1];
  const card = state.cardMap[cardId];
  const result: 'red' | 'black' = redSuits.includes(card.suit) ? 'red' : 'black';
  return { cardId, suit: card.suit, rank: card.rank, result };
}

export function register() {
  registerAtom({
    type: 'judge',
    apply(state: GameState, atom: Atom & { type: 'judge' }) {
      const player = atom.player as string;
      const s = ensureDeckHasCards(state);
      const { cardId, result } = drawJudgeCard(s);

      let newState: GameState = s;
      if (cardId) {
        newState = {
          ...s,
          zones: {
            ...s.zones,
            deck: s.zones.deck.slice(0, -1),
            discardPile: [...s.zones.discardPile, cardId],
          },
        };
      }

      if (atom.varKey && cardId) {
        newState = updatePlayer(newState, player, p => ({
          vars: { ...p.vars, [atom.varKey!]: result },
        }));
      }

      return newState;
    },
    toEvents(state: GameState, atom: Atom & { type: 'judge' }): AtomEventResult {
      const player = atom.player as string;
      const { cardId, suit, rank, result } = drawJudgeCard(state);
      const payload = { player, cardId, result, suit, rank };
      const server = makeServerEvent('judge', payload);
      return [server, new Map(), makePlayerEvent('judge', payload)];
    },
  });
}
