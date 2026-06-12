// src/engine/atoms/清过期标记.ts
// 清过期标记:清除玩家所有 duration='turn' 的 mark(回合结束自动清理)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 清过期标记: AtomDefinition<{ player: string }> = {
  type: '清过期标记',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const pIdx = state.players.findIndex(p => p.name === atom.player);
    state.players[pIdx].marks = state.players[pIdx].marks.filter(m => m.duration !== 'turn');
  },
};

registerAtom(清过期标记);
