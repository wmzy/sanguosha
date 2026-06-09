// engine/skills/红颜.ts — 红颜
import type { SkillDef } from '../types';

export const def: SkillDef = 
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
