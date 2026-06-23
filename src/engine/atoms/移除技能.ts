// src/engine/atoms/移除技能.ts
// 移除技能:从玩家移除 skillId
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 移除技能: AtomDefinition<{ player: number; skillId: string }> = {
  type: '移除技能',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    state.players[atom.player].skills = state.players[atom.player].skills.filter(id => id !== atom.skillId);
  },
  effect: { sound: 'skill_remove', animation: 'fade', duration: 400 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '移除技能',
      player: atom.player,
      skillId: atom.skillId,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const skillId = event.skillId as string;
    view.players[pi].skills = view.players[pi].skills.filter(id => id !== skillId);
  },
};

registerAtom(移除技能);
