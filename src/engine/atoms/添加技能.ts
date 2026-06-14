// src/engine/atoms/添加技能.ts
// 添加技能:为玩家添加 skillId(实际 registerAction/onInit 由 skill-loader 监听此 atom 触发)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 添加技能: AtomDefinition<{ player: number; skillId: string }> = {
  type: '添加技能',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    if (player.skills.includes(atom.skillId)) return;
    player.skills.push(atom.skillId);
  },
};

registerAtom(添加技能);
