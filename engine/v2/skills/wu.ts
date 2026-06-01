import type { SkillDef } from '../types';
import { registerSkill } from '../skill';

// ==================== 孙权 ====================

registerSkill({
  id: '制衡',
  name: '制衡',
  description: '出牌阶段，你可以弃置任意数量的牌，然后摸等量的牌。',
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
        type: 'prompt',
        text: '制衡：选择要弃置的牌',
        options: [
          { type: 'selectCards', from: 'hand', min: 1, max: 99 },
        ],
      },
      // TODO: 弃置选择的牌，摸等量的牌
      // 需要 ctx.choice 获取选择的 cardIds，然后 discard + draw
    ];
  },
});

registerSkill({
  id: '救援',
  name: '救援',
  description: '锁定技，其他吴势力角色对你使用【桃】时，你额外回复1点体力。',
  trigger: {
    event: 'heal',
    source: 'character',
  },
  handler(_ctx, _state) {
    // TODO: 需要检查 heal 来源是否为吴势力角色且不是自己
    // 且使用的牌是否为桃
    return [];
  },
});

// ==================== 甘宁 ====================

registerSkill({
  id: '奇袭',
  name: '奇袭',
  description: '你可以将一张黑色手牌当【过河拆桥】使用。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

// ==================== 吕蒙 ====================

registerSkill({
  id: '克己',
  name: '克己',
  description: '锁定技，若你未于出牌阶段内使用过【杀】，则你跳过弃牌阶段。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '弃牌',
  },
  handler(_ctx, _state) {
    return [
      {
        type: 'condition',
        check: { not: { hasVar: { player: _ctx.self, key: '杀/usedThisTurn' } } },
        then: [
          {
            type: 'atoms',
            ops: [
              { type: 'setPhase', phase: '结束' },
            ],
          },
        ],
      },
    ];
  },
});

// ==================== 黄盖 ====================

registerSkill({
  id: '苦肉',
  name: '苦肉',
  description: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
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
        type: 'atoms',
        ops: [
          { type: 'damage', target: _ctx.self, amount: 1 },
        ],
      },
      { type: 'checkDying', player: _ctx.self },
      {
        type: 'atoms',
        ops: [
          { type: 'draw', player: _ctx.self, count: 2 },
        ],
      },
    ];
  },
});

// ==================== 周瑜 ====================

registerSkill({
  id: '英姿',
  name: '英姿',
  description: '锁定技，摸牌阶段，你额外摸一张牌。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '摸牌',
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
});

registerSkill({
  id: '反间',
  name: '反间',
  description: '出牌阶段，你可以令一名其他角色选择一种花色，然后展示你的一张手牌：若此牌花色与其所选不同，其受到1点伤害。',
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
        type: 'prompt',
        text: '反间：选择目标角色',
        options: [
          { type: 'selectPlayer' },
        ],
      },
      // TODO: 目标选择花色 → 展示手牌 → 比较花色 → 若不同则 damage
    ];
  },
});

// ==================== 大乔 ====================

registerSkill({
  id: '国色',
  name: '国色',
  description: '你可以将一张♦牌当【乐不思蜀】使用。',
  trigger: {
    event: 'phaseBegin',
    source: 'character',
    phase: '出牌',
    manual: true,
    optional: true,
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: '流离',
  name: '流离',
  description: '当你成为【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的一名其他角色。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    // TODO: 需要杀目标重定向机制
    return [];
  },
});

// ==================== 陆逊 ====================

registerSkill({
  id: '谦逊',
  name: '谦逊',
  description: '锁定技，你不能成为【过河拆桥】和【顺手牵羊】的目标。',
  trigger: {
    event: 'cardPlayed',
    source: 'character',
  },
  handler(_ctx, _state) {
    return [];
  },
});

registerSkill({
  id: '连营',
  name: '连营',
  description: '当你失去最后的手牌时，你可以摸一张牌。',
  trigger: {
    event: 'cardDiscarded',
    source: 'character',
    optional: true,
    filter: { handEmpty: { $: 'ctx', path: 'self' } },
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
});

// ==================== 孙尚香 ====================

registerSkill({
  id: '结姻',
  name: '结姻',
  description: '出牌阶段，你可以弃置两张手牌，令一名已受伤的男性角色回复1点体力。',
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
        type: 'prompt',
        text: '结姻：选择要弃置的两张手牌和目标角色',
        options: [
          { type: 'selectCards', from: 'hand', min: 2, max: 2 },
          { type: 'selectPlayer', filter: { and: [{ isAlive: { $: 'ctx', path: 'choice' } }] } },
        ],
      },
      // TODO: discard 2 cards, heal target 1
    ];
  },
});

registerSkill({
  id: '枭姬',
  name: '枭姬',
  description: '当你失去一张装备区里的牌时，你可以摸一张牌。',
  trigger: {
    event: 'equipChanged',
    source: 'character',
    optional: true,
  },
  handler(_ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: 'draw', player: _ctx.self, count: 1 }] },
    ];
  },
} satisfies SkillDef);
