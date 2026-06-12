// @ts-nocheck
// engine/skills/祸首.ts — 祸首
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '祸首',
    name: '祸首',
    description: '锁定技，【南蛮入侵】对你无效；你是任何【南蛮入侵】造成伤害的来源。',
    trigger: {
      event: '回合开始',
      source: '角色',
    },
    handler(ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '加标签', player: ctx.self, tag: 'immune南蛮入侵' }] },
        { type: 'atoms', ops: [{ type: '加标签', player: ctx.self, tag: '南蛮入侵来源' }] },
      ];
    },
  },

