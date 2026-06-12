// @ts-nocheck
// engine/skills/魏延.ts — 魏延
import type { SkillDef } from '../types';

// ==================== 魏延 ====================

export const def: SkillDef = {
    id: '狂骨',
    name: '狂骨',
    description: '锁定技，当你对距离1以内的角色造成伤害后，你回复1点体力。',
    trigger: {
      event: '造成伤害',
      source: '角色',
};
export const def: SkillDef = {
  type: 'atoms', ops: [{ type: '回复体力', target: _ctx.self, amount: 1 }] },
    },
  },
];
