// @ts-nocheck
// engine/skills/黄忠.ts — 黄忠
import type { SkillDef } from '../types';

// ==================== 黄忠 ====================

export const def: SkillDef = {
    id: '烈弓',
    name: '烈弓',
    description: '当你使用【杀】指定目标后，若其手牌数≥你或体力值≥你，其不能使用【闪】。',
    trigger: {
      event: '出牌',
      source: '角色',
};
export const def: SkillDef = {
  type: 'atoms', ops: [{ type: '加标签', player: _ctx.target, tag: 'cannotDodge' }] },
    },
  },
];
