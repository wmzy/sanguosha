// engine/skills/屯田.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
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
};
