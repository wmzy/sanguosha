// engine/skills/流离.ts — 流离
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '流离',
    name: '流离',
    description: '当你成为【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的一名其他角色。',
    trigger: {
      event: '出牌',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      return [];
    },
  },
