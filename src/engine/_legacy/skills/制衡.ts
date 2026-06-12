// @ts-nocheck
// engine/skills/制衡.ts — 制衡
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '制衡',
    name: '制衡',
    description: '出牌阶段，你可以弃置任意数量的牌，然后摸等量的牌。',
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
          text: '制衡：选择要弃置的牌',
          options: [
            { type: 'selectCards', from: '手牌', min: 1, max: 99 },
          ],
        },
        {
          type: 'atoms',
          ops: [
            { type: '弃置', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice.cardIds' } },
          ],
        },
        {
          type: 'atoms',
          ops: [
            { type: '摸牌', player: _ctx.self, count: { $: 'count', source: { $: 'ctx', path: 'choice.cardIds' } } },
          ],
        },
      ];
    },
  },
