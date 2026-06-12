// src/engine/atoms/移除技能.ts
// 移除技能:从玩家移除 skillId
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 移除技能: AtomDefinition<{ player: string; skillId: string }> = {
  type: '移除技能',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const pIdx = state.players.findIndex(p => p.name === atom.player);
    state.players[pIdx].skills = state.players[pIdx].skills.filter(id => id !== atom.skillId);
  },
};

registerAtom(移除技能);
