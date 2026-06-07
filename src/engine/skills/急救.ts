// engine/skills/急救.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '急救',
    name: '急救',
    description: '你可以将一张红色手牌当【桃】使用。',
    trigger: {
      event: 'dyingResponse',
      source: '角色',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [];
    },
  };

