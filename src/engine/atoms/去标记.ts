// src/engine/atoms/去标记.ts
// 去标记:移除玩家第一个匹配 markId 的 Mark
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 去标记: AtomDefinition<{ player: number; markId: string }> = {
  type: '去标记',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const idx = player.marks.findIndex(m => m.id === atom.markId);
    if (idx < 0) return;
    player.marks.splice(idx, 1);
  },
};

registerAtom(去标记);
