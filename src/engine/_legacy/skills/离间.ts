// @ts-nocheck
// engine/skills/离间.ts — 离间
import type { SkillDef } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';

export const def: SkillDef = 
  {
    id: '离间',
    name: '离间',
    description: '出牌阶段，你可以弃置一张手牌，令一名男性角色视为对另一名男性角色使用一张【决斗】。每阶段限一次。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(ctx, state) {
      if (!ctx.target || ctx.target === ctx.self) return [];
      const self = getPlayer(state, ctx.self);
      if (self.hand.length === 0) return [];

      const targetPlayer = getPlayer(state, ctx.target);
      if (targetPlayer.info.gender !== '男') return [];

      const males = getAlivePlayerNames(state).filter(p => {
        if (p === ctx.self) return false;
        if (p === ctx.target) return false;
        return getPlayer(state, p).info.gender === '男';
      });
      if (males.length === 0) return [];

      const duelAttacker = males[0];
      const duelDefender = ctx.target;
      const discardCardId = self.hand[0];

      const defenderPlayer = getPlayer(state, duelDefender);
      const validKills = defenderPlayer.hand.filter(id => state.cardMap[id]?.name === '杀');

      const phases = [
        {
          type: 'condition' as const,
          check: { not: { hasVar: { player: ctx.self, key: '离间/usedThisTurn' } } },
          then: [
            {
              type: 'atoms' as const,
              ops: [
                { type: '弃置' as const, player: ctx.self, cardIds: [discardCardId] },
                { type: '设置变量' as const, player: ctx.self, key: '离间/usedThisTurn', value: true },
              ],
            },
            {
              type: '打出' as const,
              window: {
                type: 'duelResponse' as const,
                attacker: duelAttacker,
                defender: duelDefender,
                validCards: validKills,
                sourceCard: discardCardId,
              },
            },
          ],
        },
      ];

      return phases;
    },
  },
