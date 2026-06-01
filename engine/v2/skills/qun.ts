import type { SkillDef } from '../types';
import { registerSkill } from '../skill';

// ==================== 吕布 ====================

registerSkill({
  id: '无双',
  name: '无双',
  description: '锁定技，你使用的【杀】需两张【闪】才能抵消；与你进行【决斗】的角色每次需打出两张【杀】。',
  trigger: {
    event: 'killHit',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 貂蝉 ====================

registerSkill({
  id: '离间',
  name: '离间',
  description: '出牌阶段，你可以弃置一张手牌，令一名男性角色视为对另一名男性角色使用一张【决斗】。每阶段限一次。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    // TODO: 复杂多玩家决斗交互，需要 duel 系统支持
    return [];
  },
});

registerSkill({
  id: '闭月',
  name: '闭月',
  description: '结束阶段，你可以摸一张牌。',
  trigger: {
    event: 'turnEnd',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
});

// ==================== 华佗 ====================

registerSkill({
  id: '急救',
  name: '急救',
  description: '你可以将一张红色手牌当【桃】使用。',
  trigger: {
    event: 'dyingResponse',
    source: 'character',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: '青囊',
  name: '青囊',
  description: '出牌阶段，你可以弃置一张手牌，令一名角色回复1点体力。每阶段限一次。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'condition',
        check: { not: { hasVar: { player: _ctx.self, key: '青囊/usedThisTurn' } } },
        then: [
          {
            type: 'prompt',
            text: '青囊：选择要弃置的手牌和目标角色',
            options: [
              { type: 'selectCard', from: 'hand', min: 1, max: 1 },
              { type: 'selectPlayer' },
            ],
          },
          // TODO: discard 1 card, heal target 1
          {
            type: 'atoms',
            ops: [
              { type: 'setVar', player: _ctx.self, key: '青囊/usedThisTurn', value: true },
            ],
          },
        ],
      },
    ];
  },
} satisfies SkillDef);
