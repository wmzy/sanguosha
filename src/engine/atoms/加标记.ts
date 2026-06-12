// src/engine/atoms/加标记.ts
// 加标记:为玩家添加一个 Mark
import type { AtomDefinition, Mark } from '../types';
import { registerAtom } from '../atom';

export const 加标记: AtomDefinition<{ player: string; mark: Mark }> = {
  type: '加标记',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const pIdx = state.players.findIndex(p => p.name === atom.player);
    state.players[pIdx].marks.push(atom.mark);
  },
};

registerAtom(加标记);
