// src/engine/atoms/整理牌堆.ts
// 整理牌堆:用给定顺序替换牌堆(用于观星等技能)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 整理牌堆: AtomDefinition<{ cards: string[] }> = {
  type: '整理牌堆',
  validate(state, atom) {
    const deckSet = new Set(state.zones.deck);
    if (atom.cards.length !== state.zones.deck.length) return 'card count mismatch';
    for (const id of atom.cards) {
      if (!deckSet.has(id)) return `card ${id} not in deck`;
    }
    return null;
  },
  apply(state, atom) {
    return { ...state, zones: { ...state.zones, deck: [...atom.cards] } };
  },
};

registerAtom(整理牌堆);
