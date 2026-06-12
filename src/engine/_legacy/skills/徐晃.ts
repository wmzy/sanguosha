// @ts-nocheck
// engine/skills/徐晃.ts — 徐晃
import type { SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '断粮',
    name: '断粮',
    description: '你可以将一张黑色的基本牌或黑色装备牌当【兵粮寸断】使用；你对手牌数不小于你的角色使用【兵粮寸断】无距离限制。',
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
          text: '断粮：选择一张黑色基本牌/装备牌当兵粮寸断使用',
          options: [
            { label: '不发动', value: false },
            { type: '选择牌', from: '手牌', min: 1, max: 1 },
          ],
          defaultChoice: false,
        },
      ];
    },
  },
];
