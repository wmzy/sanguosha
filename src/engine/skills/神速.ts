// engine/skills/夏侯渊.ts — 夏侯渊
import type { SkillDef } from '../types';
import { getPlayer } from '../state';
import { getSkillConvertedCards } from '../validate';

export const def: SkillDef = {
    id: '神速',
    name: '神速',
    description: '你可以选择以下一至两项：1.跳过判定阶段和摸牌阶段；2.跳过出牌阶段并弃置一张装备牌。你每选择一项，视为对一名其他角色使用一张无距离限制的【杀】。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '判定',
      optional: true,
      manual: true,
};
export const def: SkillDef = {
          type: '打出',
          window: {
            type: 'killResponse',
            attacker: _ctx.self,
            defender: target,
            validCards,
};
    },
  },
];
