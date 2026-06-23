// src/engine/atoms/添加技能.ts
// 添加技能:为玩家添加 skillId(实际 registerAction/onInit 由 skill-loader 监听此 atom 触发)
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 添加技能: AtomDefinition<{ player: number; skillId: string }> = {
  type: '添加技能',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    if (player.skills.includes(atom.skillId)) return;
    player.skills.push(atom.skillId);
  },
  effect: { sound: 'skill_add', animation: 'glow', duration: 500 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '添加技能',
      player: atom.player,
      skillId: atom.skillId,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const skillId = event.skillId as string;
    if (!view.players[pi].skills.includes(skillId)) {
      view.players[pi].skills.push(skillId);
    }
  },
};

registerAtom(添加技能);
