// src/engine/atoms/去标签.ts
// 去标签:移除玩家的 tag(实现为去 mark id='tag:<name>')
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 去标签: AtomDefinition<{ player: number; tag: string }> = {
  type: '去标签',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    state.players[atom.player].marks = state.players[atom.player].marks.filter(m => m.id !== `tag:${atom.tag}`);
  },
};

registerAtom(去标签);
