// engine/skills/庞德.ts — 庞德
import type { SkillDef } from '../types';
import { getPlayer } from '../state';

// ==================== 庞德 ====================

export const skills: SkillDef[] = [
  {
    id: '鞬出',
    name: '鞬出',
    description: '当你使用【杀】指定一名角色为目标后，你可以弃置其一张牌，若弃置的牌为装备牌，其不能使用【闪】；若不为装备牌，其获得此【杀】。',
    trigger: {
      event: '出牌',
      source: '角色',
      optional: true,
    },
    handler(ctx, state) {
      if (!ctx.sourceCard) return [];
      const card = state.cardMap[ctx.sourceCard];
      if (card?.name !== '杀') return [];
      if (!ctx.target) return [];

      const target = getPlayer(state, ctx.target);
      if (target.hand.length === 0 && !target.equipment.武器 && !target.equipment.防具 &&
        !target.equipment.防御马 && !target.equipment.进攻马) {
        return [];
      }

      return [
        {
          type: 'prompt' as const,
          text: `鞬出：弃置 ${ctx.target} 的一张牌`,
          options: [{ type: 'selectPlayer' as const }],
        },
        {
          type: 'condition' as const,
          check: { hasValue: ctx.target },
          then: [
            {
              type: 'atoms' as const,
              ops: [
                { type: '加标签', player: ctx.target, tag: 'cannotDodge' },
              ],
            },
          ],
        },
      ];
    },
  },
];
