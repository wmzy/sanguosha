// engine/skills/曹操.ts — 曹操
import type { SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '奸雄',
    name: '奸雄',
    description: '当你受到伤害后，你可以获得对你造成伤害的牌。',
    trigger: {
      event: '受到伤害',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      // ctx.sourceCard = 造成伤害的牌 ID
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
];
