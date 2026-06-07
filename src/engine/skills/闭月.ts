// engine/skills/闭月.ts — 闭月
import type { SkillDef } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';

export const def: SkillDef = 
  {
    id: '闭月',
    name: '闭月',
    description: '结束阶段，你可以摸一张牌。',
    trigger: {
      event: '回合结束',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
      ];
    },
  },
