// src/engine/atoms/回合结束.ts
// 回合结束:清空本回合临时 vars,清 turn 持续 mark
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 回合结束: AtomDefinition<{ player: string }> = {
  type: '回合结束',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    return null;
  },
  apply(state) {
    return {
      ...state,
      turn: { ...state.turn, vars: {} },
      players: state.players.map(p => ({
        ...p,
        marks: p.marks.filter(m => m.duration !== 'turn'),
        vars: Object.fromEntries(
          Object.entries(p.vars).filter(([k]) => !k.endsWith('/usedThisTurn'))
        ),
      })),
    };
  },
  effect: { sound: 'turn_end', duration: 200 },
};

registerAtom(回合结束);
