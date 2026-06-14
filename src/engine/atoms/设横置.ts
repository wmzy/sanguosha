// src/engine/atoms/设横置.ts
// 设横置:设置玩家横置状态(简化为加/去 'chained' mark)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 设横置: AtomDefinition<{ player: number; chained: boolean }> = {
  type: '设横置',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    player.marks = player.marks.filter(m => m.id !== 'chained');
    if (atom.chained) {
      player.marks.push({ id: 'chained', scope: player.index });
    }
  },
};

registerAtom(设横置);
