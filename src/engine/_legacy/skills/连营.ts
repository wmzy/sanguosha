// @ts-nocheck
// engine/skills/连营.ts — 连营
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '连营',
    name: '连营',
    description: '当你失去最后的手牌时，你可以摸一张牌。',
    trigger: {
      event: '弃置',
      source: '角色',
      optional: true,
      filter: { handEmpty: { $: 'ctx', path: 'self' } },
    },
    handler(_ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
      ];
    },
  },
