// engine/skills/张飞.ts — 张飞
import type { SkillDef } from '../types';

// ==================== 张飞 ====================

export const skills: SkillDef[] = [
  {
    id: '咆哮',
    name: '咆哮',
    description: '锁定技，出牌阶段，你使用【杀】无次数限制。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
    },
    handler(_ctx, _state) {
      return [];
    },
  },
];
