// engine/skills/陆逊.ts — 陆逊
import type { SkillDef } from '../types';

// ==================== 陆逊 ====================

export const skills: SkillDef[] = [
  {
    id: '谦逊',
    name: '谦逊',
    description: '锁定技，你不能成为【过河拆桥】和【顺手牵羊】的目标。',
    handler(_ctx, _state) {
      return [];
    },
  },
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
];
