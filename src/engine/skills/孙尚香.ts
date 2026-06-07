// engine/skills/孙尚香.ts — 孙尚香
import type { SkillDef } from '../types';

// ==================== 孙尚香 ====================

export const skills: SkillDef[] = [
  {
    id: '结姻',
    name: '结姻',
    description: '出牌阶段，你可以弃置两张手牌，令一名已受伤的男性角色回复1点体力。',
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
          text: '结姻：选择要弃置的两张手牌和目标角色',
          options: [
            { type: 'selectCards', from: '手牌', min: 2, max: 2 },
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
            { type: '回复体力', target: { $: 'ctx', path: 'choice.player' } as const, amount: 1 },
          ],
        },
      ];
    },
  },
  {
    id: '枭姬',
    name: '枭姬',
    description: '当你失去一张装备区里的牌时，你可以摸一张牌。',
    trigger: {
      event: '装备变动',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
      ];
    },
  },
];
