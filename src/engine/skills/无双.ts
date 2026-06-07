// engine/skills/无双.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '无双',
    name: '无双',
    description: '锁定技，你使用的【杀】需两张【闪】才能抵消；与你进行【决斗】的角色每次需打出两张【杀】。',
    trigger: {
      event: '杀命中',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [];
    },
  };

