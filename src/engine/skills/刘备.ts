// engine/skills/刘备.ts — 刘备
import type { SkillDef } from '../types';

// ==================== 刘备 ====================

export const skills: SkillDef[] = [
  {
    id: '仁德',
    name: '仁德',
    description: '出牌阶段，你可以将任意数量的手牌交给其他角色。每阶段以此法给出两张或更多后，你回复1点体力。',
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
          text: '仁德：选择要送出的手牌和目标角色',
          options: [
            { type: 'selectCards', from: '手牌', min: 1, max: 99 },
            { type: 'selectPlayer' },
          ],
        },
        {
          type: 'foreach',
          collection: { $: 'ctx', path: 'choice.cardIds' },
          varName: 'giveCardId',
          body: [
            {
              type: 'atoms',
              ops: [{
                type: '移动牌',
                cardId: { $: 'ctx', path: 'localVars.giveCardId' },
                from: { zone: '手牌', player: _ctx.self },
                to: { zone: '手牌', player: { $: 'ctx', path: 'choice.target' } },
              }],
            },
          ],
        },
        {
          type: 'condition',
          check: {
            and: [
              { gte: [{ $: 'count', source: { $: 'ctx', path: 'choice.cardIds' } }, 2] },
              { not: { hasVar: { player: _ctx.self, key: '仁德/healedThisPhase' } } },
            ],
          },
          then: [
            {
              type: 'atoms',
              ops: [
                { type: '回复体力', target: _ctx.self, amount: 1 },
                { type: '设置变量', player: _ctx.self, key: '仁德/healedThisPhase', value: true },
              ],
            },
          ],
        },
      ];
    },
  },

  {
    id: '激将',
    name: '激将',
    description: '主公技，出牌阶段，你可以令一名蜀势力角色替你使用【杀】。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [];
    },
  },
];
