// src/engine/atoms/去标签.ts
// 去标签:移除玩家的 tag(实现为去 mark id='tag:<name>')
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 去标签: AtomDefinition<{ player: string; tag: string }> = {
  type: '去标签',
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
        return { ...p, marks: p.marks.filter(m => m.id !== `tag:${atom.tag}`) };
      }),
    };
  },
};

registerAtom(去标签);
