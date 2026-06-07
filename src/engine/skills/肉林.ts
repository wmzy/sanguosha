// engine/skills/肉林.ts — 肉林
import type { SkillDef } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';

export const def: SkillDef = 
  {
    id: '肉林',
    name: '肉林',
    description: '锁定技，你对女性角色/女性角色对你使用【杀】时，需连续使用两张【闪】才能抵消。',
    trigger: {
      event: '杀命中',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [];
    },
  },
