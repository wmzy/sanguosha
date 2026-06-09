// engine/skills/祝融.ts — 祝融
import type { SkillDef } from '../types';

// ==================== 祝融（林扩展包）====================

export const skills: SkillDef[] = [
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
];
