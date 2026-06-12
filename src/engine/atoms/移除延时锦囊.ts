// src/engine/atoms/移除延时锦囊.ts
// 移除延时锦囊:从玩家判定区移除指定延时锦囊
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 移除延时锦囊: AtomDefinition<{ player: string; trickName: string }> = {
  type: '移除延时锦囊',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const pIdx = state.players.findIndex(p => p.name === atom.player);
    state.players[pIdx].pendingTricks = state.players[pIdx].pendingTricks.filter(t => t.name !== atom.trickName);
  },
};

registerAtom(移除延时锦囊);
