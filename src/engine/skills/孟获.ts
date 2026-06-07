// engine/skills/孟获.ts — 孟获
import type { SkillDef } from '../types';

// ==================== 孟获（林扩展包）====================

export const skills: SkillDef[] = [
  {
    id: '祸首',
    name: '祸首',
    description: '锁定技，【南蛮入侵】对你无效；你是任何【南蛮入侵】造成伤害的来源。',
    trigger: {
      event: '回合开始',
      source: '角色',
    },
    handler(ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '加标签', player: ctx.self, tag: 'immune南蛮入侵' }] },
        { type: 'atoms', ops: [{ type: '加标签', player: ctx.self, tag: '南蛮入侵来源' }] },
      ];
    },
  },

  {
    id: '再起',
    name: '再起',
    description: '摸牌阶段，若你已受伤，你可以放弃摸牌并展示牌堆顶X张牌（X为你已损失体力值），每有一张红桃回复1点体力，然后弃掉这些红桃牌，将其余的牌收入手牌。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '摸牌',
      optional: true,
    },
    handler(ctx, state) {
      const p = state.players[ctx.self];
      const lost = p.maxHealth - p.health;
      if (lost <= 0) return [];
      return [
        {
          type: 'prompt',
          text: `再起：是否放弃摸牌，展示牌堆顶${lost}张牌？`,
          options: [
            { label: '放弃摸牌，展示', value: true },
            { label: '正常摸牌', value: false },
          ],
          defaultChoice: false,
        },
        {
          type: 'condition',
          check: { equals: [{ $: 'ctx', path: 'choice' }, true] },
          then: [
            { type: 'atoms', ops: [{ type: '摸牌', player: ctx.self, count: lost }] },
            { type: 'atoms', ops: [{ type: '设置变量', player: ctx.self, key: '再起/skipNormalDraw', value: true }] },
          ],
        },
      ];
    },
  },
];
