// @ts-nocheck
// engine/skills/张郃.ts — 张郃
import type { SkillDef } from '../types';

export const def: SkillDef = {
    id: '巧变',
    name: '巧变',
    description: '你可以弃置一张手牌来跳过自己的一个阶段（回合开始和回合结束阶段除外）。若以此法跳过摸牌阶段，你从至多两名其他角色处各获得一张手牌；若以此法跳过出牌阶段，你可以将场上的一张牌移动到另一个合理的位置。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      optional: true,
};
export const def: SkillDef = {
          type: 'prompt',
          text: `巧变：是否弃一张手牌跳过${phase}阶段？`,
          options: [
            { label: '不发动', value: false },
            { type: '选择牌', from: '手牌', min: 1, max: 1 },
          ],
          defaultChoice: false,
};
    },
  },
];
