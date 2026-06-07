// engine/skills/蔡文姬.ts — 蔡文姬
import type { SkillDef, SkillPhase } from '../types';
import { getPlayer } from '../state';

// ==================== 蔡文姬 ====================

export const skills: SkillDef[] = [
  {
    id: '悲歌',
    name: '悲歌',
    description: '当一名角色受到【杀】造成的伤害后，你可以弃置一张牌，然后令该角色判定，根据判定结果执行效果。',
    trigger: {
      event: '受到伤害',
      source: '角色',
      optional: true,
    },
    handler(ctx, state): SkillPhase[] {
      const self = getPlayer(state, ctx.self);
      if (self.hand.length === 0) return [];

      return [
        {
          type: 'prompt' as const,
          text: '悲歌：弃置一张牌进行判定',
          options: [{ type: '选择牌' as const, from: '手牌', min: 1, max: 1 }],
        },
        { type: 'atoms' as const, ops: [{ type: '判定', player: ctx.target ?? ctx.self }] },
        {
          type: 'condition' as const,
          check: { equals: [{ $: 'ctx', path: 'localVars.judgeSuit' }, '♥'] },
          then: [
            { type: 'atoms' as const, ops: [{ type: '回复体力', target: ctx.target ?? ctx.self, amount: 1 }] },
          ],
          else: [
            {
              type: 'condition' as const,
              check: { equals: [{ $: 'ctx', path: 'localVars.judgeSuit' }, '♦'] },
              then: [
                { type: 'atoms' as const, ops: [{ type: '摸牌', player: ctx.target ?? ctx.self, count: 2 }] },
              ],
            },
          ],
        },
      ];
    },
  },
  {
    id: '断肠',
    name: '断肠',
    description: '锁定技，杀死你的角色立即失去所有技能直到游戏结束。',
    handler(_ctx, _state) {
      return [];
    },
  },
];
