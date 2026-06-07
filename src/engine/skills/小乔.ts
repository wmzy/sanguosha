// engine/skills/小乔.ts — 小乔
import type { SkillDef } from '../types';

// ==================== 小乔 ====================

export const skills: SkillDef[] = [
  {
    id: '红颜',
    name: '红颜',
    description: '锁定技，你的黑桃牌均视为红桃牌。',
    trigger: {
      event: '回合开始',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '加标签', player: _ctx.self, tag: 'spadeToHeart' }] },
      ];
    },
  },
  {
    id: '天香',
    name: '天香',
    description: '当你受到伤害时，你可以弃置一张红桃手牌转移此伤害给任意一名其他角色，然后该角色摸X张牌（X为其已损失体力值）。',
    trigger: {
      event: '受到伤害',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      return [];
    },
  },
];
