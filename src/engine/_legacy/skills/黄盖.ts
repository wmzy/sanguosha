// @ts-nocheck
// engine/skills/黄盖.ts — 黄盖
import type { SkillDef } from '../types';

// ==================== 黄盖 ====================

export const skills: SkillDef[] = [
  {
    id: '苦肉',
    name: '苦肉',
    description: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [
        {
          type: 'atoms',
          ops: [
            { type: '造成伤害', target: _ctx.self, amount: 1 },
          ],
        },
        { type: 'checkDying', player: _ctx.self },
        {
          type: 'atoms',
          ops: [
            { type: '摸牌', player: _ctx.self, count: 2 },
          ],
        },
      ];
    },
  },
];
