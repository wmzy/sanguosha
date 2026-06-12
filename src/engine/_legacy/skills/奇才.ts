// @ts-nocheck
// engine/skills/奇才.ts — 奇才（黄月英）
//
// 锁定技，你使用锦囊牌无距离限制。

import type { SkillDef } from '../types';

export const def: SkillDef = {
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
};
