// src/engine/atoms/添加技能.ts
// 添加技能:为玩家添加 skillId(实际 registerAction/onInit 由 skill-loader 监听此 atom 触发)
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { broadcast, requirePlayer, viewPlayer } from './_helpers';
import { 马匹距离修正表 } from '../data/card-defs/equipment';
import { mergeDistanceVars, type DistanceVarsDelta } from './distance-vars';

export const 添加技能: AtomDefinition<{ player: number; skillId: string }> = {
  type: '添加技能',
  validate(state, atom) {
    return requirePlayer(state, atom.player, 'player');
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    if (player.skills.includes(atom.skillId)) return;
    player.skills.push(atom.skillId);
  },
  effect: { animation: 'glow', duration: 500 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '添加技能',
      player: atom.player,
      skillId: atom.skillId,
    };
    // 马匹技能的 onInit 通过 after hook 设 vars,不在 apply 内。
    // include mount distanceVars delta so applyView can sync before after hook runs.
    const mountVars = 马匹距离修正表.get(atom.skillId);
    if (mountVars) {
      view.mountDistanceVars = mountVars;
    }
    return broadcast(view);
  },
  applyView(view, event) {
    const p = viewPlayer(view, event.player as number);
    if (!p) return;
    const skillId = event.skillId as string;
    if (!p.skills.includes(skillId)) {
      p.skills.push(skillId);
    }
    // 马匹技能:同步 distanceVars(攻击马=attackMod,防御马=defenseMod)
    mergeDistanceVars(p, event.mountDistanceVars as DistanceVarsDelta | undefined);
  },
};

