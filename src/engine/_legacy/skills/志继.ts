// @ts-nocheck
// engine/skills/志继.ts — 志继
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '志继',
    name: '志继',
    description: '觉醒技，回合开始阶段，若你没有手牌，你须回复1点体力或摸两张牌，然后减1点体力上限，并永久获得技能"观星"。',
    trigger: {
      event: '回合开始',
      source: '角色',
    },
    handler(ctx, state) {
      if (state.players[ctx.self].vars['志继/awakened']) return [];
      const p = state.players[ctx.self];
      if (p.hand.length > 0) return [];
      return [
        { type: 'atoms', ops: [{ type: '设置变量', player: ctx.self, key: '志继/awakened', value: true }] },
        {
          type: 'prompt',
          text: '志继觉醒：选择回复1点体力或摸两张牌',
          options: [
            { label: '回复1点体力', value: '回复体力' },
            { label: '摸两张牌', value: '摸牌' },
          ],
          defaultChoice: '回复体力',
        },
        {
          type: 'condition',
          check: { equals: [{ $: 'ctx', path: 'choice' }, '回复体力'] },
          then: [
            { type: 'atoms', ops: [{ type: '回复体力', target: ctx.self, amount: 1 }] },
          ],
          else: [
            { type: 'atoms', ops: [{ type: '摸牌', player: ctx.self, count: 2 }] },
          ],
        },
      ];
    },
  },
