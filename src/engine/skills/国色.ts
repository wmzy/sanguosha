// engine/skills/国色.ts — 国色
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '国色',
    name: '国色',
    description: '你可以将一张♦牌当【乐不思蜀】使用。',
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
          text: '国色：选择一张♦手牌和目标角色',
          options: [
            { type: 'selectCards', from: '手牌', min: 1, max: 1 },
            { type: 'selectPlayer' },
          ],
        },
        {
          type: 'atoms',
          ops: [
            { type: '弃置', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const },
          ],
        },
        {
          type: 'atoms',
          ops: [
            {
              type: '添加延时锦囊',
              player: { $: 'ctx', path: 'choice.player' } as const,
              trick: { name: '乐不思蜀', source: _ctx.self, card: { id: '', name: '乐不思蜀', type: '锦囊牌', subtype: '锦囊', suit: '♦', rank: 'A', description: '' } },
            },
          ],
        },
      ];
    },
  },
