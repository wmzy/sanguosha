// engine/skills/于吉.ts — 于吉
import type { SkillDef } from '../types';

// ==================== 于吉 ====================

export const skills: SkillDef[] = [
  {
    id: '蛊惑',
    name: '蛊惑',
    description: '你可以扣置一张手牌当作任意一张牌使用或打出。其他角色可质疑并翻开此牌，若为假则双方各受牵连，若为真则质疑者扣减体力。',
    handler(_ctx, _state) {
      return [];
    },
  },
];
