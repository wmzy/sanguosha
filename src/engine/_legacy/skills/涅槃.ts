// engine/skills/涅槃.ts — 涅槃
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '涅槃',
    name: '涅槃',
    description: '限定技，当你处于濒死状态时，你可以弃置所有牌和判定区的牌，重置武将牌，摸三张牌并回复至3点体力。',
    trigger: {
      event: '濒死',
      source: '角色',
      optional: true,
    },
    handler(ctx, state) {
      if (state.players[ctx.self].vars['涅槃/used']) return [];
      const p = state.players[ctx.self];
      const allHandCards = [...p.hand];
      return [
        {
          type: 'atoms',
          ops: [
            { type: '弃置', player: ctx.self, cardIds: allHandCards },
            { type: '摸牌', player: ctx.self, count: 3 },
            { type: '设置变量', player: ctx.self, key: '涅槃/used', value: true },
          ],
        },
        {
          type: 'condition',
          check: { lt: [{ $: 'var', player: ctx.self, key: 'health' }, 3] },
          then: [
            { type: 'atoms', ops: [{ type: '回复体力', target: ctx.self, amount: 3 }] },
          ],
        },
      ];
    },
  },
