// src/engine/atoms/加标记.ts
// 加标记:为玩家添加一个 Mark
import type { AtomDefinition, Mark, ViewEventSplit, ViewEvent } from '../types';
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
  effect: { sound: 'mark', animation: 'pulse', duration: 400 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '加标记',
      player: atom.player,
      mark: atom.mark,
      effect: { sound: 'mark' as const, animation: 'pulse' as const, duration: 400 },
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const mark = event.mark as Mark | undefined;
    if (mark) view.players[pi].marks.push(mark);
  },
};

registerAtom(加标记);
