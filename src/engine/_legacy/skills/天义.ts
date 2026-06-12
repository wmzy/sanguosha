// @ts-nocheck
// engine/skills/天义.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '天义',
    name: '天义',
    description: '出牌阶段，你可以与一名角色拼点，若你赢，本回合你攻击范围无限、可额外使用一张【杀】、使用【杀】时可额外指定一个目标；若你没赢，你不能使用【杀】直到回合结束。',
    handler(_ctx, _state) {
      return [];
    },
  };

