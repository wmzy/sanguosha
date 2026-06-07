// engine/skills/雷击.ts — 雷击
import type { SkillDef, SkillPhase } from '../types';

export const def: SkillDef = 
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
