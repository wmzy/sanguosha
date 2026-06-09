// engine/skills/挑衅.ts — 挑衅
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '挑衅',
    name: '挑衅',
    description: '出牌阶段，你可以指定一名使用【杀】能攻击到你的角色，该角色需对你使用一张【杀】，否则你弃其一张牌。每回合限一次。',
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
          text: '挑衅：选择一名能攻击到你的角色',
          options: [
            { type: 'selectPlayer' },
          ],
        },
      ];
    },
  },

