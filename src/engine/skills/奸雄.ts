// engine/skills/曹操.ts — 曹操
import type { SkillDef } from '../types';

export const def: SkillDef = {
    id: '奸雄',
    name: '奸雄',
    description: '当你受到伤害后，你可以获得对你造成伤害的牌。',
    trigger: {
      event: '受到伤害',
      source: '角色',
      optional: true,
};
export const def: SkillDef = {
          type: 'atoms',
          ops: [
            {
              type: '获得',
              player: _ctx.self,
              cardId: _ctx.sourceCard,
              from: { zone: '弃牌堆' },
};
    },
  },
];
