// engine/skills/放权.ts — 放权
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '放权',
    name: '放权',
    description: '你可以跳过出牌阶段，然后在回合结束时弃置一张手牌，令一名其他角色进行一个额外回合。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [
        {
          type: 'prompt',
          text: '放权：是否跳过出牌阶段？',
          options: [
            { label: '跳过出牌阶段', value: true },
            { label: '取消', value: false },
          ],
          defaultChoice: false,
        },
      ];
    },
  },

