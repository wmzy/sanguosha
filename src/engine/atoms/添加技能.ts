// src/engine/atoms/添加技能.ts
// 添加技能:为玩家添加 skillId(实际 registerAction/onInit 由 skill-loader 监听此 atom 触发)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 添加技能: AtomDefinition<{ player: string; skillId: string }> = {
  type: '添加技能',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const pIdx = state.players.findIndex(p => p.name === atom.player);
    return {
      ...state,
      players: state.players.map((p, i) => {
        if (i !== pIdx) return p;
        if (p.skills.includes(atom.skillId)) return p;
        return { ...p, skills: [...p.skills, atom.skillId] };
      }),
    };
  },
};

registerAtom(添加技能);
