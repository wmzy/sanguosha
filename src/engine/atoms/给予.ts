// src/engine/atoms/给予.ts
// 给予:从 from 玩家手牌将 cardId 给予 to 玩家
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 给予: AtomDefinition<{ cardId: string; from: string; to: string }> = {
  type: '给予',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    const fromP = state.players.find(p => p.name === atom.from);
    if (!fromP) return `from ${atom.from} not found`;
    if (!fromP.hand.includes(atom.cardId)) return `card not in from's hand`;
    if (!state.players.find(p => p.name === atom.to)) return `to ${atom.to} not found`;
    return null;
  },
  apply(state, atom) {
    const fromIdx = state.players.findIndex(p => p.name === atom.from);
    const toIdx = state.players.findIndex(p => p.name === atom.to);
    const fromP = state.players[fromIdx];
    const toP = state.players[toIdx];
    return {
      ...state,
      players: state.players.map((p, i) => {
        if (i === fromIdx) return { ...p, hand: p.hand.filter(id => id !== atom.cardId) };
        if (i === toIdx) return { ...p, hand: [...p.hand, atom.cardId] };
        return p;
      }),
    };
  },
};

registerAtom(给予);
