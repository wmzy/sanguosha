// src/engine/atoms/设横置.ts
// 设横置:设置玩家横置状态(简化为加/去 'chained' mark)
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 设横置: AtomDefinition<{ player: number; chained: boolean }> = {
  type: '设横置',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    player.marks = player.marks.filter(m => m.id !== 'chained');
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
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const chained = event.chained as boolean;
    view.players[pi].marks = view.players[pi].marks.filter(m => m.id !== 'chained');
    if (chained) {
      view.players[pi].marks.push({ id: 'chained', scope: view.players[pi].index });
    }
  },
};

registerAtom(设横置);
