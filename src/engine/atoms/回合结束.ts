// src/engine/atoms/回合结束.ts
// 回合结束:清空本回合临时 vars,清 turn 持续 mark
import type { AtomDefinition, GameView } from '../types';
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
      // 清理所有 per-turn 标记(约定后缀):/usedThisTurn(限一次)、/healed(已回血)、/givenCount(累计计数)
      p.vars = Object.fromEntries(
        Object.entries(p.vars).filter(([k]) =>
          !k.endsWith('/usedThisTurn') &&
          !k.endsWith('/healed') &&
          !k.endsWith('/givenCount'),
        ),
      );
    }
  },
  effect: { sound: 'turn_end', duration: 800 },
  applyView(view: GameView) {
    // 清空本回合临时 vars(与 apply 对称)
    view.turn.vars = {};
    // 清理每个玩家 duration==='turn' 的 marks(view 侧可见)
    for (const p of view.players) {
      p.marks = p.marks.filter(m => m.duration !== 'turn');
    }
  },
};

registerAtom(回合结束);
