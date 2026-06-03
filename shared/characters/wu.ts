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

// ==================== 风扩展包 ====================

export const 小乔: CharacterConfig = {
  name: '小乔',
  maxHealth: 3,
  gender: '女',
  faction: '吴',
  abilities: [
    {
      name: '天香',
      description: '当你受到伤害时，你可以弃置一张红桃手牌转移此伤害给任意一名其他角色，然后该角色摸X张牌（X为其已损失体力值）。',
      trigger: 'onDamageReceived',
      condition: { hasHandCards: true },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'discard', count: 1 },
          { type: 'dealDamage', target: 'otherPlayer', amount: 1 },
          { type: 'draw', count: 1 },
        ],
      },
    },
    {
      name: '红颜',
      description: '锁定技，你的黑桃牌均视为红桃牌。',
      trigger: 'onTurnStart',
      effect: { type: 'draw', count: 0 },
      passive: true,
    },
  ],
};

export const 周泰: CharacterConfig = {
  name: '周泰',
  maxHealth: 4,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '不屈',
      description: '锁定技，当你处于濒死状态时，你可以将牌堆顶一张牌作为"创"牌置于武将牌上，若此牌点数与已有的"创"牌均不同，你回复至1体力；否则死亡。',
      trigger: 'onDamageReceived',
      effect: { type: 'dealDamage', amount: 0 },
      passive: true,
    },
  ],
};

// ==================== 火扩展包 ====================

export const 太史慈: CharacterConfig = {
  name: '太史慈',
  maxHealth: 4,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '天义',
      description: '出牌阶段，你可以与一名角色拼点，若你赢，本回合你攻击范围无限、可额外使用一张【杀】、使用【杀】时可额外指定一个目标；若你没赢，你不能使用【杀】直到回合结束。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'dealDamage', target: 'otherPlayer', amount: 0 },
          { type: 'draw', count: 0 },
        ],
      },
      oncePerTurn: true,
    },
  ],
};

// ==================== 林扩展包 ====================

export const 鲁肃: CharacterConfig = {
  name: '鲁肃',
  maxHealth: 3,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '好施',
      description: '摸牌阶段，你可以额外摸两张牌，若此时你的手牌数超过五张，你必须将一半（向下取整）的手牌交给除你外手牌数最少的一名角色。',
      trigger: 'onTurnStart',
      condition: { phase: '摸牌' },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'draw', count: 2 },
        ],
      },
      oncePerTurn: true,
    },
    {
      name: '缔盟',
      description: '出牌阶段，你可以选择两名其他角色，弃置等同于这两名角色手牌数差的牌，然后交换他们的手牌。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'discard', count: 'any' },
          { type: 'draw', count: 0 },
        ],
      },
      oncePerTurn: true,
    },
  ],
};

export const 孙坚: CharacterConfig = {
  name: '孙坚',
  maxHealth: 4,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '英魂',
      description: '回合开始阶段，若你已受伤，可令一名其他角色选择一项：1.摸X张牌再弃一张牌；2.摸一张牌再弃X张牌（X为你已损失体力值）。',
      trigger: 'onTurnStart',
      condition: { phase: '准备' },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'draw', count: 1 },
          { type: 'discard', count: 1 },
        ],
      },
      oncePerTurn: true,
    },
  ],
};

// ==================== 山扩展包 ====================

export const 孙策: CharacterConfig = {
  name: '孙策',
  maxHealth: 4,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '激昂',
      description: '每当你使用（指定目标后）或被使用（成为目标后）一张【决斗】或红色的【杀】时，你可以摸一张牌。',
      trigger: 'onCardPlayed',
      effect: { type: 'draw', count: 1 },
    },
    {
      name: '魂姿',
      description: '觉醒技，回合开始阶段，若你的体力为1，你须减1点体力上限，并永久获得技能"英姿"和"英魂"。',
      trigger: 'onTurnStart',
      condition: { phase: '准备' },
      effect: { type: 'dealDamage', amount: 0 },
      passive: true,
    },
    {
      name: '制霸',
      description: '主公技，其他吴势力角色的出牌阶段，可与你进行一次拼点。',
      trigger: 'manual',
      effect: { type: 'dealDamage', target: 'otherPlayer', amount: 0 },
    },
  ],
};

export const 张昭张纮: CharacterConfig = {
  name: '张昭张纮',
  maxHealth: 3,
  gender: '男',
  faction: '吴',
  abilities: [
    {
      name: '直谏',
      description: '出牌阶段，你可以将手牌中的一张装备牌置于一名其他角色的装备区（不得替换原装备），然后摸一张牌。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'discard', count: 1 },
          { type: 'draw', count: 1 },
        ],
      },
    },
    {
      name: '固政',
      description: '其他角色的弃牌阶段结束时，你可以将弃牌堆中一张该角色弃置的牌返回其手牌，然后获得其余弃牌。',
      trigger: 'onTurnEnd',
      effect: { type: 'draw', count: 1 },
      passive: true,
    },
  ],
};

export const wuCharacters: CharacterConfig[] = [
  孙权, 甘宁, 吕蒙, 黄盖, 周瑜, 大乔, 陆逊, 孙尚香,
  小乔, 周泰, 太史慈, 鲁肃, 孙坚, 孙策, 张昭张纮,
];
