// engine/skills/左慈.ts — 左慈
import type { SkillDef } from '../types';

// ==================== 左慈 ====================

export const skills: SkillDef[] = [
  {
    id: '化身',
    name: '化身',
    description: '游戏开始时，你随机获得两张未登场的武将牌作为化身牌，然后亮出其中一张，你获得该化身牌上的一个技能。',
    handler(_ctx, _state) {
      return [];
    },
  },
  {
    id: '新生',
    name: '新生',
    description: '每当你受到1点伤害后，你可以获得一张新的化身牌。',
    handler(_ctx, _state) {
      return [];
    },
  },
];
