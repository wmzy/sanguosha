// src/engine/atoms/移除技能.ts
// 移除技能:从玩家移除 skillId
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { broadcast, requirePlayer, viewPlayer } from './_helpers';
import { 马匹距离修正表 } from '../data/card-defs/equipment';

export const 移除技能: AtomDefinition<{ player: number; skillId: string }> = {
  type: '移除技能',
  validate(state, atom) {
    return requirePlayer(state, atom.player, 'player');
  },
  apply(state, atom) {
    state.players[atom.player].skills = state.players[atom.player].skills.filter(
      (id) => id !== atom.skillId,
    );
  },
  effect: { animation: 'fade', duration: 400 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '移除技能',
      player: atom.player,
      skillId: atom.skillId,
    };
    // 马匹技能:卸下时 onInit 返回的 cleanup 通过 after hook 删 vars。
    // include mount distanceVars keys to clear so applyView can sync.
    const mountVars = 马匹距离修正表.get(atom.skillId);
    if (mountVars) {
      view.clearMountDistanceVars = mountVars;
    }
    return broadcast(view);
  },
  applyView(view, event) {
    const p = viewPlayer(view, event.player as number);
    if (!p) return;
    const skillId = event.skillId as string;
    p.skills = p.skills.filter((id) => id !== skillId);
    // 马匹技能:清除对应的 distanceVars(攻击马=attackMod,防御马=defenseMod)
    const clearVars = event.clearMountDistanceVars as
      | { attackMod?: number; defenseMod?: number }
      | undefined;
    if (clearVars) {
      p.distanceVars = {
        ...p.distanceVars,
        attackMod:
          clearVars.attackMod !== undefined ? undefined : p.distanceVars?.attackMod,
        defenseMod:
          clearVars.defenseMod !== undefined
            ? undefined
            : p.distanceVars?.defenseMod,
      };
    }
  },
};

