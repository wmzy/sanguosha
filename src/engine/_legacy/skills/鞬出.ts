// @ts-nocheck
// engine/skills/庞德.ts — 庞德
import type { SkillDef } from '../types';
import { getPlayer } from '../state';

// ==================== 庞德 ====================

export const def: SkillDef = {
    id: '鞬出',
    name: '鞬出',
    description: '当你使用【杀】指定一名角色为目标后，你可以弃置其一张牌，若弃置的牌为装备牌，其不能使用【闪】；若不为装备牌，其获得此【杀】。',
    trigger: {
      event: '出牌',
      source: '角色',
      optional: true,
};
export const def: SkillDef = {
          type: 'prompt' as const,
          text: `鞬出：弃置 ${ctx.target} 的一张牌`,
          options: [{ type: 'selectPlayer' as const }],
};
export const def: SkillDef = {
          type: 'condition' as const,
          check: { hasValue: ctx.target },
          then: [
            {
              type: 'atoms' as const,
              ops: [
                { type: '加标签', player: ctx.target, tag: 'cannotDodge' },
              ],
};
    },
  },
];
