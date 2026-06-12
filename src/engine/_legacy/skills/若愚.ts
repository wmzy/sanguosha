// @ts-nocheck
// engine/skills/若愚.ts — 若愚
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '若愚',
    name: '若愚',
    description: '主公技，觉醒技，回合开始阶段，若你的体力是全场最少的（或之一），你须增加1点体力上限并回复1点体力，然后永久获得技能"激将"。',
    trigger: {
      event: '回合开始',
      source: '角色',
    },
    handler(ctx, state) {
      if (state.players[ctx.self].vars['若愚/awakened']) return [];
      const myHealth = state.players[ctx.self].health;
      const allHealths = state.playerOrder
        .filter(n => state.players[n].info.alive)
        .map(n => state.players[n].health);
      const minHealth = Math.min(...allHealths);
      if (myHealth > minHealth) return [];
      return [
        { type: 'atoms', ops: [{ type: '设置变量', player: ctx.self, key: '若愚/awakened', value: true }] },
      ];
    },
  },
