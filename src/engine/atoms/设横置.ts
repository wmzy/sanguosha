// src/engine/atoms/设横置.ts
// 设横置:设置玩家横置状态(简化为加/去 'chained' mark)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 设横置: AtomDefinition<{ player: string; chained: boolean }> = {
  type: '设横置',
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
        const without = p.marks.filter(m => m.id !== 'chained');
        return atom.chained
          ? { ...p, marks: [...without, { id: 'chained', scope: p.index }] }
          : { ...p, marks: without };
      }),
    };
  },
};

registerAtom(设横置);
