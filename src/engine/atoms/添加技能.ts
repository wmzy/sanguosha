// src/engine/atoms/添加技能.ts
// 添加技能:为玩家添加 skillId(实际 registerAction/onInit 由 skill-loader 监听此 atom 触发)
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { MOUNT_DISTANCE_VARS } from '../skills/马匹技能';

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
    // 马匹技能的 onInit 通过 after hook 设 vars,不在 apply 内。
    // include mount distanceVars delta so applyView can sync before after hook runs.
    const mountVars = MOUNT_DISTANCE_VARS[atom.skillId];
    if (mountVars) {
      view.mountDistanceVars = mountVars;
    }
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const skillId = event.skillId as string;
    if (!view.players[pi].skills.includes(skillId)) {
      view.players[pi].skills.push(skillId);
    }
    // 马匹技能:同步 distanceVars(攻击马=attackMod,防御马=defenseMod)
    const mountVars = event.mountDistanceVars as { attackMod?: number; defenseMod?: number } | undefined;
    if (mountVars) {
      view.players[pi].distanceVars = {
        ...view.players[pi].distanceVars,
        ...mountVars,
      };
    }
  },
};

registerAtom(添加技能);
