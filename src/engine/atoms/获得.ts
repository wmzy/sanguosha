// src/engine/atoms/获得.ts
// 获得:玩家获得一张牌(可选从指定玩家处)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 获得: AtomDefinition<{ player: string; cardId: string; from?: string }> = {
  type: '获得',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    if (atom.from && !state.players.find(p => p.name === atom.from)) return `from ${atom.from} not found`;
    return null;
  },
  apply(state, atom) {
    let next = { ...state };
    if (atom.from) {
      const fromIdx = next.players.findIndex(p => p.name === atom.from);
      const fromP = next.players[fromIdx];
      const hand = fromP.hand.filter(id => id !== atom.cardId);
      const equipment: Record<string, string> = {};
      for (const [slot, id] of Object.entries(fromP.equipment)) {
        if (id && id !== atom.cardId) equipment[slot] = id;
      }
      next.players = next.players.map((p, i) => i === fromIdx ? { ...p, hand, equipment } : p);
    }
    const toIdx = next.players.findIndex(p => p.name === atom.player);
    const toP = next.players[toIdx];
    const newHand = [...toP.hand, atom.cardId];
    next.players = next.players.map((p, i) => i === toIdx ? { ...p, hand: newHand } : p);
    return next;
  },
};

registerAtom(获得);
