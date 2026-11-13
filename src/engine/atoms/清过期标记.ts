// src/engine/atoms/清过期标记.ts
// 清过期标记:清除玩家所有 duration='turn' 的 mark(回合结束自动清理)
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { broadcast, requirePlayer, viewPlayer } from './_helpers';

export const 清过期标记: AtomDefinition<{ player: number }> = {
  type: '清过期标记',
  validate(state, atom) {
    return requirePlayer(state, atom.player, 'player');
  },
  apply(state, atom) {
    state.players[atom.player].marks = state.players[atom.player].marks.filter(
      (m) => m.duration !== 'turn',
    );
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = { type: '清过期标记', player: atom.player };
    return broadcast(view);
  },
  applyView(view, event) {
    const p = viewPlayer(view, event.player as number);
    if (!p) return;
    p.marks = p.marks.filter((m) => m.duration !== 'turn');
  },
};

