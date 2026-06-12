// @ts-nocheck
// engine/skills/放逐.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '放逐',
  name: '放逐',
  description: '每当你受到一次伤害后，可以令除你以外的任一角色补X张牌（X为你已损失体力值），然后该角色将其武将牌翻面。',
  trigger: {
    event: '受到伤害',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const selfPlayer = _state.players[_ctx.self];
    if (!selfPlayer) return [];
    const lostHealth = selfPlayer.maxHealth - selfPlayer.health;
    if (lostHealth <= 0) return [];

    return [
      {
        type: 'prompt',
        text: `放逐：令一名角色补${lostHealth}张牌并翻面`,
        options: [
          { label: '不发动', value: false },
          { type: 'selectPlayer' },
        ],
        defaultChoice: false,
      },
    ];
  },
};
