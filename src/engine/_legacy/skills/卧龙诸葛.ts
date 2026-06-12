// @ts-nocheck
// engine/skills/卧龙诸葛.ts — 卧龙诸葛
import type { SkillDef } from '../types';

// ==================== 卧龙诸葛（火扩展包）====================

export const skills: SkillDef[] = [
  {
    id: '八阵',
    name: '八阵',
    description: '锁定技，当你没有装备防具时，始终视为你装备着【八卦阵】。',
    trigger: {
      event: '回合开始',
      source: '角色',
    },
    handler(ctx, state) {
      const p = state.players[ctx.self];
      if (p.equipment.防具) return [];
      return [
        { type: 'atoms', ops: [{ type: '加标签', player: ctx.self, tag: 'virtualArmor' }] },
      ];
    },
  },

  {
    id: '火计',
    name: '火计',
    description: '你可以将一张红色手牌当【火攻】使用。',
    handler(_ctx, _state) {
      return [];
    },
  },

  {
    id: '看破',
    name: '看破',
    description: '你可以将一张黑色手牌当【无懈可击】使用。',
    handler(_ctx, _state) {
      return [];
    },
  },
];
