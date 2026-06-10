// src/engine/atoms/加标签.ts
// 加标签:为玩家加 tag(实现为 mark id='tag:<name>')
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 加标签: AtomDefinition<{ player: string; tag: string }> = {
  type: '加标签',
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
        if (p.marks.some(m => m.id === `tag:${atom.tag}`)) return p;
        return { ...p, marks: [...p.marks, { id: `tag:${atom.tag}`, scope: p.index }] };
      }),
    };
  },
};

registerAtom(加标签);
