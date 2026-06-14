// src/engine/atoms/回合结束.ts
// 回合结束:清空本回合临时 vars,清 turn 持续 mark
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 回合结束: AtomDefinition<{ player: number }> = {
  type: '回合结束',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state) {
    state.turn.vars = {};
    for (const p of state.players) {
      p.marks = p.marks.filter(m => m.duration !== 'turn');
      p.vars = Object.fromEntries(
        Object.entries(p.vars).filter(([k]) => !k.endsWith('/usedThisTurn')),
      );
    }
  },
  effect: { sound: 'turn_end', duration: 200 },
};

registerAtom(回合结束);
