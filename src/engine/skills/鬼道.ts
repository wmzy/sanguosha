// engine/skills/鬼道.ts — 鬼道
import type { SkillDef, SkillPhase } from '../types';

export const def: SkillDef = 
  {
    id: '鬼道',
    name: '鬼道',
    description: '当一名角色的判定牌生效前，你可以用一张黑色牌替换之。',
    handler(_ctx, _state) {
      return [];
    },
  },
