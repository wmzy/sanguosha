// engine/skills/驱虎.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '驱虎',
  name: '驱虎',
  description: '出牌阶段，你可以与一名角色拼点，若你赢，该角色对其攻击范围内另一名角色造成1点伤害；若你没赢，该角色对你造成1点伤害。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '出牌',
    optional: true,
    manual: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'prompt',
        text: '驱虎：选择拼点目标',
        options: [
          { label: '不发动', value: false },
          { type: 'selectPlayer', filter: { handEmpty: _ctx.self } },
        ],
        defaultChoice: false,
      },
    ];
  },
};
