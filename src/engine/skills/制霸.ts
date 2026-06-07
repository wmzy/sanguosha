// engine/skills/制霸.ts — 制霸
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '制霸',
    name: '制霸',
    description: '主公技，其他吴势力角色的出牌阶段，可与你进行一次拼点。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [];
    },
  },
