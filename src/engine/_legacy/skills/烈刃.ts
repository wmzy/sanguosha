// @ts-nocheck
// engine/skills/烈刃.ts — 烈刃
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '烈刃',
    name: '烈刃',
    description: '每当你使用【杀】造成伤害后，可与受伤害的角色拼点：若你赢，你获得对方的一张牌。',
    trigger: {
      event: '造成伤害',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      if (_ctx.source !== _ctx.self) return [];
      if (!_ctx.target) return [];
      // 拼点机制需要引擎支持，当前返回空
      return [];
    },
  },
