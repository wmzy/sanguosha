// engine/skills/反馈.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '反馈',
  name: '反馈',
  description: '当你受到伤害后，你可以获得伤害来源的一张牌。',
  trigger: {
    event: '受到伤害',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    if (!_ctx.source) return [];
    const sourcePlayer = _state.players[_ctx.source];
    if (!sourcePlayer || sourcePlayer.hand.length === 0) return [];
    return [
      {
        type: 'atoms',
        ops: [
          { type: '随机弃置', player: _ctx.source, count: 1, from: '手牌' },
        ],
      },
      {
        type: 'atoms',
        ops: [
          {
            type: '获得',
            player: _ctx.self,
            cardId: { $: 'ctx', path: 'localVars.discardedCardId' },
            from: { zone: '弃牌堆' },
          },
        ],
      },
    ];
  },
};
