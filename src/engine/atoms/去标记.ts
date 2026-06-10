// src/engine/atoms/去标记.ts
// 去标记:移除玩家第一个匹配 markId 的 Mark
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 去标记: AtomDefinition<{ player: string; markId: string }> = {
  type: '去标记',
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
        const idx = p.marks.findIndex(m => m.id === atom.markId);
        if (idx < 0) return p;
        return { ...p, marks: [...p.marks.slice(0, idx), ...p.marks.slice(idx + 1)] };
      }),
    };
  },
};

registerAtom(去标记);
