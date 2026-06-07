// engine/skills/暴虐.ts — 暴虐
import type { SkillDef } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';

export const def: SkillDef = 
  {
    id: '暴虐',
    name: '暴虐',
    description: '主公技，其他群雄角色每造成一次伤害，可进行一次判定，若结果为黑桃，你回复1点体力。',
    handler(_ctx, _state) {
      return [];
    },
  },
