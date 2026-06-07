// engine/skills/曹仁.ts — 曹仁
import type { SkillDef } from '../types';

export const def: SkillDef = {
    id: '据守',
    name: '据守',
    description: '结束阶段，你可以翻面并摸三张牌，然后跳过你的下一回合。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '结束',
      optional: true,
};
export const def: SkillDef = {
  type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 3 }] },
        { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '据守/flipped', value: true }] },
    },
  },
];
