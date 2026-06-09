// engine/skills/张角.ts — 张角
import type { SkillDef, SkillPhase } from '../types';

// ==================== 张角 ====================

export const skills: SkillDef[] = [
  {
    id: '雷击',
    name: '雷击',
    description: '当你使用或打出【闪】时，可令任意一名角色判定，若结果为黑桃，你对该角色造成2点雷电伤害。',
    trigger: {
      event: '出牌',
      source: '角色',
      optional: true,
    },
    handler(ctx, state): SkillPhase[] {
      if (!ctx.sourceCard) return [];
      const card = state.cardMap[ctx.sourceCard];
      if (card?.name !== '闪') return [];

      return [
        {
          type: 'prompt' as const,
          text: '雷击：选择判定的目标角色',
          options: [{ type: 'selectPlayer' as const }],
        },
        { type: 'atoms' as const, ops: [{ type: '判定', player: ctx.self }] },
        {
          type: 'condition' as const,
          check: { equals: [{ $: 'ctx', path: 'localVars.judgeSuit' }, '♠'] },
          then: [
            {
              type: 'atoms' as const,
              ops: [
                { type: '造成伤害', target: ctx.target ?? ctx.self, amount: 2, source: ctx.self },
              ],
            },
          ],
        },
      ];
    },
  },
  {
    id: '鬼道',
    name: '鬼道',
    description: '当一名角色的判定牌生效前，你可以用一张黑色牌替换之。',
    handler(_ctx, _state) {
      return [];
    },
  },
  {
    id: '黄天',
    name: '黄天',
    description: '主公技，其他群势力角色可以在其出牌阶段将一张【闪】或【闪电】交给你。',
    handler(_ctx, _state) {
      return [];
    },
  },
];
