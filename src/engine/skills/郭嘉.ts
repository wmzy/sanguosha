// engine/skills/郭嘉.ts — 郭嘉
import type { SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '天妒',
    name: '天妒',
    description: '当你的判定牌生效后，你可以获得此判定牌。',
    trigger: {
      event: '判定结果',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      // ctx.sourceCard = 判定牌 ID
      if (!_ctx.sourceCard) return [];
      return [
        {
          type: 'atoms',
          ops: [
            {
              type: '获得',
              player: _ctx.self,
              cardId: _ctx.sourceCard,
              from: { zone: '弃牌堆' },
            },
          ],
        },
      ];
    },
  },

  {
    id: '遗计',
    name: '遗计',
    description: '当你受到1点伤害后，你可以摸两张牌。',
    trigger: {
      event: '受到伤害',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 2 }] },
        {
          type: 'prompt',
          text: '遗计：选择最多2张牌分配给其他角色（或不分配）',
          options: [
            { label: '不分配', value: false },
            { type: 'selectCards', from: '手牌', min: 1, max: 2 },
          ],
          defaultChoice: false,
        },
        {
          type: 'condition',
          check: { notEquals: [{ $: 'ctx', path: 'choice' }, false] },
          then: [
            { type: 'atoms', ops: [{ type: '设置上下文变量', key: '遗计/cards', value: { $: 'ctx', path: 'choice' } as const }] },
            { type: 'atoms', ops: [{ type: '弃置', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice' } as const }] },
            {
              type: 'prompt',
              text: '遗计：选择获得牌的目标角色',
              options: [
                { type: 'selectPlayer' },
              ],
            },
            {
              type: 'foreach',
              collection: { $: 'ctx', path: 'localVars.遗计/cards' },
              varName: 'currentCard',
              body: [
                {
                  type: 'atoms',
                  ops: [{
                    type: '获得',
                    player: { $: 'ctx', path: 'choice' },
                    cardId: { $: 'ctx', path: 'localVars.currentCard' },
                    from: { zone: '弃牌堆' },
                  }],
                },
              ],
            },
          ],
        },
      ];
    },
  },
];
