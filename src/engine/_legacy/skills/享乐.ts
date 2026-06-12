// @ts-nocheck
// engine/skills/享乐.ts — 享乐
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '享乐',
    name: '享乐',
    description: '锁定技，当其他角色使用【杀】指定你为目标时，需额外弃置一张基本牌，否则该【杀】对你无效。',
    trigger: {
      event: '出牌',
      source: '角色',
    },
    handler(_ctx, _state) {
      if (!_ctx.sourceCard) return [];
      const card = _state.cardMap[_ctx.sourceCard];
      if (card?.name !== '杀') return [];
      if (!_ctx.target || _ctx.target !== _ctx.self) return [];
      const attacker = (_ctx.event as Record<string, unknown>)['player'] as string;
      if (!attacker || attacker === _ctx.self) return [];
      return [
        { type: 'atoms', ops: [{ type: '加标签', player: attacker, tag: '享乐/discardBasic' }] },
      ];
    },
  },

