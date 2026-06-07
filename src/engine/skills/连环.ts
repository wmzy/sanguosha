// engine/skills/连环.ts — 连环
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '连环',
    name: '连环',
    description: '你可以将一张梅花手牌当【铁索连环】使用或重铸。',
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

