// engine/skills/黄天.ts — 黄天
import type { SkillDef, SkillPhase } from '../types';

export const def: SkillDef = 
  {
    id: '黄天',
    name: '黄天',
    description: '主公技，其他群势力角色可以在其出牌阶段将一张【闪】或【闪电】交给你。',
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
