// engine/skills/好施.ts — 好施
import type { SkillDef, SkillPhase } from '../types';
import { getPlayer } from '../state';

export const def: SkillDef = 
  {
    id: '好施',
    name: '好施',
    description: '摸牌阶段，你可以额外摸两张牌，若此时你的手牌数超过五张，你必须将一半（向下取整）的手牌交给除你外手牌数最少的一名角色。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '摸牌',
    },
    handler(_ctx, _state) {
      const player = getPlayer(_state, _ctx.self);
      const phases: SkillPhase[] = [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 2 }] },
      ];

      if (player.hand.length + 2 > 5) {
        const others = _state.playerOrder.filter(
          n => n !== _ctx.self && _state.players[n].info.alive,
        );
        if (others.length > 0) {
          const minHand = Math.min(...others.map(n => _state.players[n].hand.length));
          const minPlayers = others.filter(n => _state.players[n].hand.length === minHand);
          const target = minPlayers[0];
          const giveCount = Math.floor((player.hand.length + 2) / 2);
          phases.push({
            type: 'prompt',
            text: `好施：将 ${giveCount} 张手牌交给 ${target}`,
            options: [
              { type: 'selectCards', from: '手牌', min: giveCount, max: giveCount },
            ],
          });
          phases.push({
            type: 'foreach',
            collection: { $: 'ctx', path: 'choice.cardIds' },
            varName: 'giveCardId',
            body: [
              {
                type: 'atoms',
                ops: [{
                  type: '移动牌',
                  cardId: { $: 'ctx', path: 'localVars.giveCardId' },
                  from: { zone: '手牌', player: _ctx.self },
                  to: { zone: '手牌', player: target },
                }],
              },
            ],
          });
        }
      }

      return phases;
    },
  },
