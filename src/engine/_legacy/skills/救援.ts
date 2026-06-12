// @ts-nocheck
// engine/skills/救援.ts — 救援
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '救援',
    name: '救援',
    description: '锁定技，其他吴势力角色对你使用【桃】时，你额外回复1点体力。',
    trigger: {
      event: '回复体力',
      source: '角色',
    },
    handler(_ctx, _state) {
      const source = _ctx.source;
      if (!source || source === _ctx.self) return [];
      if (_ctx.target !== _ctx.self) return [];
      const sourcePlayer = _state.players[source];
      if (!sourcePlayer?.info?.faction || sourcePlayer.info.faction !== '吴') return [];
      return [
        { type: 'atoms', ops: [{ type: '回复体力', target: _ctx.self, amount: 1 }] },
      ];
    },
  },
