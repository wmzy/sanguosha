// engine/skills/新生.ts — 新生
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '新生',
    name: '新生',
    description: '每当你受到1点伤害后，你可以获得一张新的化身牌。',
    trigger: {
      event: '受到伤害',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [];
    },
  },
