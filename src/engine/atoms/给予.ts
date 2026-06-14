// src/engine/atoms/给予.ts
// 给予:从 from 玩家手牌将 cardId 给予 to 玩家
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 给予: AtomDefinition<{ cardId: string; from: number; to: number }> = {
  type: '给予',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    const fromP = state.players[atom.from];
    if (!fromP) return `from ${atom.from} not found`;
    if (!fromP.hand.includes(atom.cardId)) return `card not in from's hand`;
    if (!state.players[atom.to]) return `to ${atom.to} not found`;
    return null;
  },
  apply(state, atom) {
    const fromIdx = atom.from;
    const toIdx = atom.to;
    state.players[fromIdx].hand = state.players[fromIdx].hand.filter(id => id !== atom.cardId);
    state.players[toIdx].hand.push(atom.cardId);
  },
};

registerAtom(给予);
