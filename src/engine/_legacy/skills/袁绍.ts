// @ts-nocheck
// engine/skills/袁绍.ts — 袁绍
import type { SkillDef } from '../types';
import { getPlayer } from '../state';

// ==================== 袁绍 ====================

export const skills: SkillDef[] = [
  {
    id: '乱击',
    name: '乱击',
    description: '你可以将两张同花色手牌当【万箭齐发】使用。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(ctx, state) {
      const self = getPlayer(state, ctx.self);
      if (self.hand.length < 2) return [];

      type SuitGroup = Record<string, string[]>;
      const groups: SuitGroup = {};
      for (const cardId of self.hand) {
        const card = state.cardMap[cardId];
        if (!card) continue;
        const suit = card.suit;
        if (!groups[suit]) groups[suit] = [];
        groups[suit].push(cardId);
      }

      const hasPair = Object.values(groups).some(g => g.length >= 2);
      if (!hasPair) return [];

      return [
        {
          type: 'prompt' as const,
          text: '乱击：选择两张同花色手牌当【万箭齐发】',
          options: [{ type: 'selectCards' as const, from: '手牌', min: 2, max: 2 }],
        },
      ];
    },
  },
];
