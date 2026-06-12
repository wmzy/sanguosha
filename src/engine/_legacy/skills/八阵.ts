// @ts-nocheck
// engine/skills/八阵.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
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
};
