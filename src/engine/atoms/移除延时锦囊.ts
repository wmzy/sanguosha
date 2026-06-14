// src/engine/atoms/移除延时锦囊.ts
// 移除延时锦囊:从玩家判定区移除指定延时锦囊
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 移除延时锦囊: AtomDefinition<{ player: number; trickName: string }> = {
  type: '移除延时锦囊',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    state.players[atom.player].pendingTricks = state.players[atom.player].pendingTricks.filter(t => t.name !== atom.trickName);
  },
};

registerAtom(移除延时锦囊);
