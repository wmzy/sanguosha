// @ts-nocheck
import type { GameState, Atom, Json } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';
import type { Card } from '../../shared/types';

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
    type: '判定',
    apply(state: GameState, atom: Atom & { type: '判定' }) {
      const player = atom.player as string;
      const s = ensureDeckHasCards(state);
      const { cardId, suit, result } = drawJudgeCard(s);

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

      // §4.6 修复：把判定牌显式存到 state.localVars，避免 getResult 从
      // discardPile[top] 误读（判定期间其他弃牌操作可能插错牌）。
      // 字段覆盖：judgeCardId / judgeSuit / judgeColor（保持 getResult 既有
      // 字段名，向后兼容所有读 localVars.judgeColor/judgeSuit 的技能）。
      newState = {
        ...newState,
        localVars: {
          ...(newState.localVars ?? {}),
          ...(cardId !== null
            ? { judgeCardId: cardId, judgeSuit: suit, judgeColor: result }
            : {}),
        },
      };

      return newState;
    },
    getResult(state: GameState, _atom: Atom & { type: '判定' }): Record<string, Json> {
      // §4.6 修复：优先读 state.localVars（apply 写入的判定牌 ID），避免
      // discardPile[top] 在多步骤技能中被其他弃牌覆盖。fallback 保留以兼容
      // 旧调用站点直接调用 getResult 而未经过 apply 的极端情况。
      const stored = state.localVars?.judgeCardId;
      if (typeof stored === 'string' && state.cardMap[stored]) {
        const card = state.cardMap[stored];
        const result: 'red' | 'black' = redSuits.includes(card.suit) ? 'red' : 'black';
        return { judgeCardId: stored, judgeSuit: card.suit, judgeColor: result };
      }
      const discardPile = state.zones.discardPile;
      if (discardPile.length === 0) return {};
      const cardId = discardPile[discardPile.length - 1];
      const card = state.cardMap[cardId];
      if (!card) return {};
      const result: 'red' | 'black' = redSuits.includes(card.suit) ? 'red' : 'black';
      return { judgeCardId: cardId, judgeSuit: card.suit, judgeColor: result };
    },
  });
}
