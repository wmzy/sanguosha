// engine/skills/华佗.ts — 华佗
import type { SkillDef } from '../types';

// ==================== 华佗 ====================

export const skills: SkillDef[] = [
  {
    id: '急救',
    name: '急救',
    description: '你可以将一张红色手牌当【桃】使用。',
    trigger: {
      event: 'dyingResponse',
      source: '角色',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [];
    },
  },
  {
    id: '青囊',
    name: '青囊',
    description: '出牌阶段，你可以弃置一张手牌，令一名角色回复1点体力。每阶段限一次。',
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
          type: 'condition',
          check: { not: { hasVar: { player: _ctx.self, key: '青囊/usedThisTurn' } } },
          then: [
            {
              type: 'prompt',
              text: '青囊：选择要弃置的手牌和目标角色',
              options: [
                { type: '选择牌', from: '手牌', min: 1, max: 1 },
                { type: 'selectPlayer' },
              ],
            },
            {
              type: 'atoms',
              ops: [
                { type: '设置变量', player: _ctx.self, key: '青囊/usedThisTurn', value: true },
              ],
            },
          ],
        },
      ];
    },
  },
];
