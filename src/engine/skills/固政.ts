// engine/skills/固政.ts — 固政
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '固政',
    name: '固政',
    description: '其他角色的弃牌阶段结束时，你可以将弃牌堆中一张该角色弃置的牌返回其手牌，然后获得其余弃牌。',
    handler(_ctx, _state) {
      return [];
    },
  },
