// engine/skills/太史慈.ts — 太史慈
import type { SkillDef } from '../types';

// ==================== 太史慈 ====================

export const def: SkillDef = {
    id: '天义',
    name: '天义',
    description: '出牌阶段，你可以与一名角色拼点，若你赢，本回合你攻击范围无限、可额外使用一张【杀】、使用【杀】时可额外指定一个目标；若你没赢，你不能使用【杀】直到回合结束。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
};
