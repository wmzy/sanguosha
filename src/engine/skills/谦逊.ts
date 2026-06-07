// engine/skills/谦逊.ts — 谦逊
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '谦逊',
    name: '谦逊',
    description: '锁定技，你不能成为【过河拆桥】和【顺手牵羊】的目标。',
    trigger: {
      event: '出牌',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [];
    },
  },
