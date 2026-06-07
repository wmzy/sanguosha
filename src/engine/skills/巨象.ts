// engine/skills/巨象.ts — 巨象
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '巨象',
    name: '巨象',
    description: '锁定技，【南蛮入侵】对你无效；若其他角色使用的【南蛮入侵】在结算完时进入弃牌堆，你立即获得它。',
    trigger: {
      event: '回合开始',
      source: '角色',
    },
    handler(ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '加标签', player: ctx.self, tag: 'immune南蛮入侵' }] },
        { type: 'atoms', ops: [{ type: '加标签', player: ctx.self, tag: 'collect南蛮入侵' }] },
      ];
    },
  },

