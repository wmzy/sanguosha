// engine/skills/枭姬.ts — 枭姬
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '枭姬',
    name: '枭姬',
    description: '当你失去一张装备区里的牌时，你可以摸一张牌。',
    trigger: {
      event: '装备变动',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
      ];
    },
  },
