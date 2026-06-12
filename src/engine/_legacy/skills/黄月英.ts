// @ts-nocheck
// engine/skills/黄月英.ts — 黄月英
import type { SkillDef } from '../types';

// ==================== 黄月英 ====================

export const skills: SkillDef[] = [
  {
    id: '集智',
    name: '集智',
    description: '当你使用一张非延时锦囊牌时，你可以摸一张牌。',
    trigger: {
      event: '出牌',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
      ];
    },
  },

  {
    id: '奇才',
    name: '奇才',
    description: '锁定技，你使用锦囊牌无距离限制。',
    trigger: {
      event: '回合开始',
      source: '角色',
    },
    handler(ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '加标签', player: ctx.self, tag: 'noTrickDistanceLimit' }] },
      ];
    },
  },
];
