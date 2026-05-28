import type { CharacterConfig } from './types';

// ============================================================
// 魏国
// ============================================================

export const 曹操: CharacterConfig = {
  name: '曹操',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '奸雄',
      description: '当你受到伤害后，你可以获得对你造成伤害的牌。',
      trigger: 'onDamageReceived',
      effect: { type: 'gainCard', source: 'damageSourceCard' },
      passive: true,
    },
  ],
};

export const 司马懿: CharacterConfig = {
  name: '司马懿',
  maxHealth: 3,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '反馈',
      description: '当你受到伤害后，你可以获得伤害来源的一张牌。',
      trigger: 'onDamageReceived',
      effect: { type: 'gainCard', source: 'attacker', count: 1 },
      passive: true,
    },
    {
      name: '鬼才',
      description: '当一张判定牌生效前，你可以打出一张手牌代替之。',
      trigger: 'onCardPlayed',
      condition: { cardType: '判定牌' },
      effect: { type: 'convert', from: 'handCard', to: '判定结果' },
    },
  ],
};

export const 夏侯惇: CharacterConfig = {
  name: '夏侯惇',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '刚烈',
      description: '当你受到伤害后，你可以进行判定：若结果不为♥，伤害来源弃置两张手牌或受到1点伤害。',
      trigger: 'onDamageReceived',
      effect: {
        type: 'sequence',
        steps: [
          { type: 'judge', expectedSuit: '♥', failEffect: 'attackerDiscardOrDamage' },
        ],
      },
      passive: true,
    },
  ],
};

export const 张辽: CharacterConfig = {
  name: '张辽',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '突袭',
      description: '摸牌阶段，你可以放弃摸牌，改为获得最多两名其他角色的各一张手牌。',
      trigger: 'onTurnStart',
      condition: { phase: '摸牌' },
      effect: { type: 'sequence', steps: [
        { type: 'skipDraw' },
        { type: 'gainCard', source: 'otherPlayers', count: 2 },
      ] },
    },
  ],
};

export const 许褚: CharacterConfig = {
  name: '许褚',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '裸衣',
      description: '摸牌阶段，你可以少摸一张牌，若如此做，你使用【杀】或【决斗】时，此牌造成的伤害+1。',
      trigger: 'onTurnStart',
      condition: { phase: '摸牌' },
      effect: { type: 'sequence', steps: [
        { type: 'skipDraw' },
        { type: 'dealDamage', bonusDamage: 1, condition: '杀或决斗' },
      ] },
    },
  ],
};

export const 郭嘉: CharacterConfig = {
  name: '郭嘉',
  maxHealth: 3,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '天妒',
      description: '当你的判定牌生效后，你可以获得此判定牌。',
      trigger: 'onJudge',
      effect: { type: 'gainCard', source: 'judgeCard' },
      passive: true,
    },
    {
      name: '遗计',
      description: '当你受到1点伤害后，你可以摸两张牌。',
      trigger: 'onDamageReceived',
      effect: { type: 'draw', count: 2 },
      passive: true,
    },
  ],
};

export const 甄姬: CharacterConfig = {
  name: '甄姬',
  maxHealth: 3,
  gender: '女',
  faction: '魏',
  abilities: [
    {
      name: '倾国',
      description: '你可以将一张黑色手牌当【闪】使用或打出。',
      trigger: 'manual',
      effect: { type: 'convert', from: 'blackHandCard', to: '闪' },
    },
    {
      name: '洛神',
      description: '准备阶段，你可以进行判定：若结果为黑色，你获得此牌，且可以重复此流程。',
      trigger: 'onTurnStart',
      condition: { phase: '准备' },
      effect: { type: 'sequence', steps: [
        { type: 'judge', repeatOnBlack: true },
        { type: 'gainCard', source: 'judgeCard' },
      ] },
    },
  ],
};

// ============================================================
// 蜀国
// ============================================================

export const 刘备: CharacterConfig = {
  name: '刘备',
  maxHealth: 4,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '仁德',
      description: '出牌阶段，你可以将任意数量的手牌交给其他角色。每阶段以此法给出两张或更多后，你回复1点体力。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: {
        type: 'sequence',
        steps: [
          { type: 'giveCards', count: 'any', target: 'otherPlayer' },
          {
            type: 'conditional',
            condition: { cardsGivenThisPhase: { gte: 2 } },
            then: { type: 'heal', target: 'self', amount: 1 },
          },
        ],
      },
    },
  ],
};

export const 关羽: CharacterConfig = {
  name: '关羽',
  maxHealth: 4,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '武圣',
      description: '你可以将一张红色手牌当【杀】使用或打出。',
      trigger: 'manual',
      effect: { type: 'convert', from: 'redHandCard', to: '杀' },
    },
  ],
};

export const 张飞: CharacterConfig = {
  name: '张飞',
  maxHealth: 4,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '咆哮',
      description: '锁定技，出牌阶段，你使用【杀】无次数限制。',
      trigger: 'manual',
      effect: { type: 'draw', count: 0 },
      passive: true,
    },
  ],
};

export const 赵云: CharacterConfig = {
  name: '赵云',
  maxHealth: 4,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '龙胆',
      description: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。',
      trigger: 'manual',
      effect: { type: 'convert', from: '杀闪互转', to: '杀闪互转' },
    },
  ],
};

export const 诸葛亮: CharacterConfig = {
  name: '诸葛亮',
  maxHealth: 3,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '观星',
      description: '准备阶段，你可以观看牌堆顶的X张牌（X为存活角色数且至多为5），并将任意数量的牌以任意顺序置于牌堆顶，其余以任意顺序置于牌堆底。',
      trigger: 'onTurnStart',
      condition: { phase: '准备' },
      effect: { type: 'lookAtTopCards', count: 'alivePlayers' },
    },
    {
      name: '空城',
      description: '锁定技，当你没有手牌时，你不能成为【杀】或【决斗】的目标。',
      trigger: 'onTargeted',
      condition: { hasHandCards: false },
      effect: { type: 'conditional', condition: { targetCard: '杀或决斗' }, then: { type: 'skipPhase' } },
      passive: true,
    },
  ],
};

export const 黄月英: CharacterConfig = {
  name: '黄月英',
  maxHealth: 3,
  gender: '女',
  faction: '蜀',
  abilities: [
    {
      name: '集智',
      description: '当你使用一张非延时锦囊牌时，你可以摸一张牌。',
      trigger: 'onCardPlayed',
      condition: { cardType: '非延时锦囊' },
      effect: { type: 'draw', count: 1 },
      passive: true,
    },
    {
      name: '奇才',
      description: '锁定技，你使用锦囊牌无距离限制。',
      trigger: 'manual',
      effect: { type: 'draw', count: 0 },
      passive: true,
    },
  ],
};

export const 马超: CharacterConfig = {
  name: '马超',
  maxHealth: 4,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '马术',
      description: '锁定技，你计算与其他角色的距离时，始终-1。',
      trigger: 'manual',
      effect: { type: 'draw', count: 0 },
      passive: true,
    },
    {
      name: '铁骑',
      description: '当你使用【杀】指定一名角色为目标后，你可以进行判定：若结果为红色，该角色不能使用【闪】。',
      trigger: 'onDamageDealt',
      effect: { type: 'sequence', steps: [
        { type: 'judge', redResult: 'prevent闪' },
      ] },
    },
  ],
};

// ============================================================
// 吴国
// ============================================================

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

// ============================================================
// 群雄
// ============================================================

export const 华佗: CharacterConfig = {
  name: '华佗',
  maxHealth: 3,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '急救',
      description: '你可以将一张红色手牌当【桃】使用。',
      trigger: 'manual',
      effect: { type: 'convert', from: 'redHandCard', to: '桃' },
    },
    {
      name: '青囊',
      description: '出牌阶段，你可以弃置一张手牌，令一名角色回复1点体力。每阶段限一次。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: { type: 'sequence', steps: [
        { type: 'discard', count: 1 },
        { type: 'heal', target: 'anyPlayer', amount: 1 },
      ] },
      oncePerTurn: true,
    },
  ],
};

export const 吕布: CharacterConfig = {
  name: '吕布',
  maxHealth: 4,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '无双',
      description: '锁定技，你使用的【杀】需两张【闪】才能抵消；与你进行【决斗】的角色每次需打出两张【杀】。',
      trigger: 'manual',
      effect: { type: 'draw', count: 0 },
      passive: true,
    },
  ],
};

export const 貂蝉: CharacterConfig = {
  name: '貂蝉',
  maxHealth: 3,
  gender: '女',
  faction: '群',
  abilities: [
    {
      name: '离间',
      description: '出牌阶段，你可以弃置一张手牌，令一名男性角色视为对另一名男性角色使用一张【决斗】。每阶段限一次。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: { type: 'sequence', steps: [
        { type: 'discard', count: 1 },
        { type: 'dealDamage', condition: '决斗', target: 'malePlayer' },
      ] },
      oncePerTurn: true,
    },
    {
      name: '闭月',
      description: '结束阶段，你可以摸一张牌。',
      trigger: 'onTurnEnd',
      effect: { type: 'draw', count: 1 },
    },
  ],
};

// ============================================================
// 所有角色列表
// ============================================================

export const weiCharacters: CharacterConfig[] = [曹操, 司马懿, 夏侯惇, 张辽, 许褚, 郭嘉, 甄姬];
export const shuCharacters: CharacterConfig[] = [刘备, 关羽, 张飞, 赵云, 诸葛亮, 黄月英, 马超];
export const wuCharacters: CharacterConfig[] = [孙权, 甘宁, 吕蒙, 黄盖, 周瑜, 大乔, 陆逊, 孙尚香];
export const qunCharacters: CharacterConfig[] = [华佗, 吕布, 貂蝉];

export const allCharacters: CharacterConfig[] = [
  ...weiCharacters,
  ...shuCharacters,
  ...wuCharacters,
  ...qunCharacters,
];
