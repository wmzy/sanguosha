// src/engine/atoms/抽牌.ts
// 抽牌:从牌堆顶取指定 cardId 给予玩家
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 抽牌: AtomDefinition<{ player: number; cardId: string }> = {
  type: '抽牌',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    if (!state.zones.deck.includes(atom.cardId)) return `card not in deck`;
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    state.players[atom.player].hand.push(atom.cardId);
  },
};

registerAtom(抽牌);
