// engine/skills/激将.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '激将',
  name: '激将',
  description: '主公技，出牌阶段，你可以令一名蜀势力角色替你使用【杀】。',
  handler(_ctx, _state) {
    return [];
  },
};
