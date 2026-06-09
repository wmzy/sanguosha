// engine/skills/魂姿.ts — 魂姿
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '魂姿',
    name: '魂姿',
    description: '觉醒技，回合开始阶段，若你的体力为1，你须减1点体力上限，并永久获得技能"英姿"和"英魂"。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '准备',
    },
    handler(_ctx, _state) {
      const p = _state.players[_ctx.self];
      if (p.vars['魂姿/awakened']) return [];
      if (p.health !== 1) return [];

      return [
        { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '魂姿/awakened', value: true }] },
        { type: 'atoms', ops: [{ type: '设上限', player: _ctx.self, delta: -1 }] },
        { type: 'atoms', ops: [{ type: '加技能', player: _ctx.self, skillId: '英姿' }] },
        { type: 'atoms', ops: [{ type: '加技能', player: _ctx.self, skillId: '英魂' }] },
      ];
    },
  },
