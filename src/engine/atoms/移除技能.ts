// src/engine/atoms/移除技能.ts
// 移除技能:从玩家移除 skillId
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 移除技能: AtomDefinition<{ player: number; skillId: string }> = {
  type: '移除技能',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    state.players[atom.player].skills = state.players[atom.player].skills.filter(id => id !== atom.skillId);
  },
};

registerAtom(移除技能);
