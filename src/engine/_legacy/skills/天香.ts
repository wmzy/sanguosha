// @ts-nocheck
// engine/skills/天香.ts — 天香
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '天香',
    name: '天香',
    description: '当你受到伤害时，你可以弃置一张红桃手牌转移此伤害给任意一名其他角色，然后该角色摸X张牌（X为其已损失体力值）。',
    handler(_ctx, _state) {
      return [];
    },
  },
