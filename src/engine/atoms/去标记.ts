// src/engine/atoms/去标记.ts
// 去标记:移除玩家第一个匹配 markId 的 Mark
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 去标记: AtomDefinition<{ player: number; markId: string }> = {
  type: '去标记',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const idx = player.marks.findIndex(m => m.id === atom.markId);
    if (idx < 0) return;
    player.marks.splice(idx, 1);
  },
  effect: { sound: 'mark', animation: 'pulse', duration: 300 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '去标记',
      player: atom.player,
      markId: atom.markId,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const markId = event.markId as string | undefined;
    if (markId) {
      view.players[pi].marks = view.players[pi].marks.filter(m => m.id !== markId);
    }
  },
};

registerAtom(去标记);
