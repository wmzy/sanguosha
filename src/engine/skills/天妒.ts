// engine/skills/天妒.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
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
};
