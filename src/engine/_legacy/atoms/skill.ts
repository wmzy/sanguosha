// @ts-nocheck
// engine/atoms/skill.ts — `加技能` atom
// [P5-T2] 改写：技能所有权走 PlayerState.skills（v3 真相源），不再写 state.triggers。
// 外部 source 参数保留兼容（外部未传时不再走 CharacterMapSource 路径）。
// 调用方 0 破坏：原子形参 { type, player, skillId, source? } 不变。

import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';
import { addSkillToPlayer } from '../mark';

export function register() {
  registerAtom({
    type: '加技能',
    apply(state: GameState, atom: Atom & { type: '加技能' }): GameState {
      const player = atom.player as string;
      const skillId = atom.skillId;
      // 幂等：玩家已有此技能则 no-op
      if (state.players[player]?.skills.includes(skillId)) return state;
      return addSkillToPlayer(state, player, skillId);
    },
  });
}
