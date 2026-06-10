// src/engine/atoms/抽牌.ts
// 抽牌:从牌堆顶取指定 cardId 给予玩家
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 抽牌: AtomDefinition<{ player: string; cardId: string }> = {
  type: '抽牌',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    if (!state.zones.deck.includes(atom.cardId)) return `card not in deck`;
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const pIdx = state.players.findIndex(p => p.name === atom.player);
    return {
      ...state,
      zones: { ...state.zones, deck: state.zones.deck.filter(id => id !== atom.cardId) },
      players: state.players.map((p, i) => i === pIdx ? { ...p, hand: [...p.hand, atom.cardId] } : p),
    };
  },
};

registerAtom(抽牌);
