import type { CharacterConfig } from '../types';

export const 孙权: CharacterConfig = {
  name: '孙权',
  maxHealth: 4,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '制衡',
      description: '出牌阶段，你可以弃置任意数量的牌，然后摸等量的牌。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'discard', count: 'any' },
          { type: 'draw', count: 'sameAsDiscarded' },
        ],
      },
    },
    {
      name: '救援',
      description: '锁定技，其他吴势力角色对你使用【桃】时，你额外回复1点体力。',
      trigger: 'onHealReceived',
      effect: { type: 'heal', target: 'self', amount: 1 },
      passive: true,
    },
  ],
};

export const 甘宁: CharacterConfig = {
  name: '甘宁',
  maxHealth: 4,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '奇袭',
      description: '你可以将一张黑色手牌当【过河拆桥】使用。',
      trigger: 'manual',
      effect: { type: 'convert', from: 'blackHandCard', to: '过河拆桥' },
    },
  ],
};

export const 吕蒙: CharacterConfig = {
  name: '吕蒙',
  maxHealth: 4,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '克己',
      description: '锁定技，若你未于出牌阶段内使用过【杀】，则你跳过弃牌阶段。',
      trigger: 'onTurnEnd',
      condition: { phase: '弃牌', 杀UsedThisTurn: false },
      effect: { type: 'skipPhase', target: '弃牌' },
      passive: true,
    },
  ],
};

export const 黄盖: CharacterConfig = {
  name: '黄盖',
  maxHealth: 4,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '苦肉',
      description: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
      trigger: 'manual',
      condition: { phase: '出牌' },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'dealDamage', target: 'self', amount: 1 },
          { type: 'draw', count: 2 },
        ],
      },
    },
  ],
};

export const 周瑜: CharacterConfig = {
  name: '周瑜',
  maxHealth: 3,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '反间',
      description: '出牌阶段，你可以令一名其他角色选择一种花色，然后展示你的一张手牌：若此牌花色与其所选不同，其受到1点伤害。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: { type: 'dealDamage', condition: '反间判定', amount: 1, target: 'otherPlayer' },
    },
    {
      name: '英姿',
      description: '锁定技，摸牌阶段，你额外摸一张牌。',
      trigger: 'onTurnStart',
      condition: { phase: '摸牌' },
      effect: { type: 'draw', count: 1 },
      passive: true,
    },
  ],
};

export const 大乔: CharacterConfig = {
  name: '大乔',
  maxHealth: 3,
  gender: '女',
  faction: '吴',
  abilities: [
    {
      name: '国色',
      description: '你可以将一张♦牌当【乐不思蜀】使用。',
      trigger: 'manual',
      effect: { type: 'convert', from: '♦handCard', to: '乐不思蜀' },
    },
    {
      name: '流离',
      description: '当你成为【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的一名其他角色。',
      trigger: 'onTargeted',
      condition: { targetCard: '杀' },
      effect: { type: 'redirect', from: 'self', to: 'adjacentPlayer' },
    },
  ],
};

export const 陆逊: CharacterConfig = {
  name: '陆逊',
  maxHealth: 3,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '谦逊',
      description: '锁定技，你不能成为【过河拆桥】和【顺手牵羊】的目标。',
      trigger: 'onTargeted',
      condition: { targetCard: '过河拆桥或顺手牵羊' },
      effect: { type: 'skipPhase' },
      passive: true,
    },
    {
      name: '连营',
      description: '当你失去最后的手牌时，你可以摸一张牌。',
      trigger: 'onHandEmpty',
      effect: { type: 'draw', count: 1 },
    },
  ],
};

export const 孙尚香: CharacterConfig = {
  name: '孙尚香',
  maxHealth: 3,
  gender: '女',
  faction: '吴',
  abilities: [
    {
      name: '结姻',
      description: '出牌阶段，你可以弃置两张手牌，令一名已受伤的男性角色回复1点体力。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: { type: 'sequence', steps: [
        { type: 'discard', count: 2 },
        { type: 'heal', target: 'injuredMaleAlly', amount: 1 },
      ] },
    },
    {
      name: '枭姬',
      description: '当你失去一张装备区里的牌时，你可以摸一张牌。',
      trigger: 'onEquipChange',
      effect: { type: 'draw', count: 1 },
    },
  ],
};

export const wuCharacters: CharacterConfig[] = [孙权, 甘宁, 吕蒙, 黄盖, 周瑜, 大乔, 陆逊, 孙尚香];
