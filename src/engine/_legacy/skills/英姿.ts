// @ts-nocheck
// engine/skills/英姿.ts — 英姿
import type { SkillDef } from '../types';
import { getPlayer } from '../state';

export const def: SkillDef = 
  {
    id: '英姿',
    name: '英姿',
    description: '锁定技，摸牌阶段，你额外摸一张牌。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '摸牌',
    },
    handler(_ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
      ];
    },
  },
