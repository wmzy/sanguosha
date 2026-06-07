// engine/skills/于吉.ts — 于吉
import type { SkillDef } from '../types';

// ==================== 于吉 ====================

export const def: SkillDef = {
    id: '蛊惑',
    name: '蛊惑',
    description: '你可以扣置一张手牌当作任意一张牌使用或打出。其他角色可质疑并翻开此牌，若为假则双方各受牵连，若为真则质疑者扣减体力。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
};
