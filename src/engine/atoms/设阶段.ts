// src/engine/atoms/设阶段.ts
// 设阶段:直接覆盖 state.phase
import type { AtomDefinition, GameView, TurnPhase } from '../types';
import { registerAtom } from '../atom';

export const 设阶段: AtomDefinition<{ phase: TurnPhase }> = {
  type: '设阶段',
  validate(state, atom) {
    const valid: TurnPhase[] = ['准备', '判定', '摸牌', '出牌', '弃牌', '回合结束'];
    if (!valid.includes(atom.phase)) return `invalid phase ${atom.phase}`;
    return null;
  },
  apply(state, atom) {
    state.phase = atom.phase;
    state.turn.phase = atom.phase;
  },
  applyView(view: GameView, event) {
    const phase = event.phase as TurnPhase;
    view.phase = phase;
    view.turn.phase = phase;
  },
};

registerAtom(设阶段);
