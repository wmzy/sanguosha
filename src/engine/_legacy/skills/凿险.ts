// @ts-nocheck
// engine/skills/凿险.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '凿险',
  name: '凿险',
  description: '准备阶段，若"田"的数量≥3，你须减1点体力上限，然后获得技能"急袭"（你可以将一张"田"当【顺手牵羊】使用）。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '准备',
  },
  handler(_ctx, _state) {
    const p = _state.players[_ctx.self];
    if (p.vars['凿险/awakened']) return [];
    const count = (p.vars['屯田/count'] as number) ?? 0;
    if (count < 3) return [];

    return [
      { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '凿险/awakened', value: true }] },
      { type: 'atoms', ops: [{ type: '设上限', player: _ctx.self, delta: -1 }] },
    ];
  },
};
