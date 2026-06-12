// @ts-nocheck
// engine/skills/集智.ts — 集智（黄月英）
//
// 当你使用一张非延时锦囊牌时，你可以摸一张牌。

import type { SkillDef } from '../types';

export const def: SkillDef = {
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
};
