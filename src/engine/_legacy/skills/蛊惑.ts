// @ts-nocheck
// engine/skills/蛊惑.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '蛊惑',
    name: '蛊惑',
    description: '你可以扣置一张手牌当作任意一张牌使用或打出。其他角色可质疑并翻开此牌，若为假则双方各受牵连，若为真则质疑者扣减体力。',
    handler(_ctx, _state) {
      return [];
    },
  };

