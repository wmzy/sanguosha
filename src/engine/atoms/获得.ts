// src/engine/atoms/获得.ts
// 获得:玩家获得一张牌(可选从指定玩家处)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 获得: AtomDefinition<{ player: number; cardId: string; from?: number }> = {
  type: '获得',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (atom.from && !state.players[atom.from]) return `from ${atom.from} not found`;
    return null;
  },
  apply(state, atom) {
    if (atom.from) {
      const fromP = state.players[atom.from];
      fromP.hand = fromP.hand.filter(id => id !== atom.cardId);
      const equipment: Record<string, string> = {};
      for (const [slot, id] of Object.entries(fromP.equipment)) {
        if (id && id !== atom.cardId) equipment[slot] = id;
      }
      fromP.equipment = equipment;
    }
    state.players[atom.player].hand.push(atom.cardId);
  },
};

registerAtom(获得);
