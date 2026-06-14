// src/engine/atoms/加标记.ts
// 加标记:为玩家添加一个 Mark
import type { AtomDefinition, Mark } from '../types';
import { registerAtom } from '../atom';

export const 加标记: AtomDefinition<{ player: number; mark: Mark }> = {
  type: '加标记',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    state.players[atom.player].marks.push(atom.mark);
  },
};

registerAtom(加标记);
