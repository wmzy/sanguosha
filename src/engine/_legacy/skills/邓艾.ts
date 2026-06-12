// @ts-nocheck
// engine/skills/邓艾.ts — 邓艾
import type { SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '屯田',
    name: '屯田',
    description: '每次当你于回合外失去牌时，可进行一次判定，将非红桃的判定牌置于你的武将牌上，称为"田"；每有一张田，你计算与其他角色的距离便减少1。',
    trigger: {
      event: '弃置',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      const e = _ctx.event as Record<string, unknown> | undefined;
      // 只在自己失去牌时触发
      if (e?.['player'] !== _ctx.self) return [];
      // 只在回合外触发
      if (_state.currentPlayer === _ctx.self) return [];

      return [
        { type: 'atoms', ops: [{ type: '判定', player: _ctx.self, varKey: '屯田/judgeResult' }] },
        {
          type: 'condition',
          check: { notEquals: [{ $: 'var', player: _ctx.self, key: '屯田/judgeResult' }, '♥'] },
          then: [
            { type: 'atoms', ops: [{ type: '增加变量', player: _ctx.self, key: '屯田/count', delta: 1 }] },
          ],
        },
      ];
    },
  },

  {
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
  },
];
