// @ts-nocheck
// engine/atoms/removeSkill.ts — `去技能` atom
// [P5-T2] 改写：技能所有权走 PlayerState.skills，不再过滤 state.triggers。

import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';
import { removeSkillFromPlayer } from '../mark';

export function register() {
  registerAtom({
    type: '去技能',
    apply(state: GameState, atom: Atom & { type: '去技能' }): GameState {
      const player = atom.player as string;
      const skillId = atom.skillId;
      return removeSkillFromPlayer(state, player, skillId);
    },
  });
}
