// src/engine/atoms/设横置.ts
// 设横置:设置玩家横置状态(简化为加/去 'chained' mark)
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { broadcast, requirePlayer, viewPlayer } from './_helpers';

export const 设横置: AtomDefinition<{ player: number; chained: boolean }> = {
  type: '设横置',
  validate(state, atom) {
    return requirePlayer(state, atom.player, 'player');
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    player.marks = player.marks.filter((m) => m.id !== 'chained');
    if (atom.chained) {
      player.marks.push({ id: 'chained', scope: player.index });
    }
  },
  effect: { sound: 'chain', animation: 'pulse', duration: 500 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '设横置',
      player: atom.player,
      chained: atom.chained,
    };
    return broadcast(view);
  },
  applyView(view, event) {
    const p = viewPlayer(view, event.player as number);
    if (!p) return;
    const chained = event.chained as boolean;
    p.marks = p.marks.filter((m) => m.id !== 'chained');
    if (chained) {
      p.marks.push({ id: 'chained', scope: p.index });
    }
  },
};

