import type { CharacterConfig } from '../types';

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
      effect: { type: 'sequence', steps: [] },
      passive: true,
      modifiers: ['unlimitedKills'],
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
      effect: { type: 'sequence', steps: [] },
      passive: true,
      modifiers: ['distanceMinus1'],
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

// ==================== 风扩展包 ====================

export const 黄忠: CharacterConfig = {
  name: '黄忠',
  maxHealth: 4,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '烈弓',
      description: '当你使用【杀】指定目标时，若目标的体力值或手牌数不小于你，你可以令其不能使用【闪】抵消此【杀】。',
      trigger: 'onTargeted',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

export const 魏延: CharacterConfig = {
  name: '魏延',
  maxHealth: 4,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '狂骨',
      description: '锁定技，当你对距离1以内的一名角色造成1点伤害时，你回复1点体力。',
      trigger: 'onDamageDealt',
      effect: { type: 'heal', amount: 1, target: 'self' },
      passive: true,
    },
  ],
};

// ==================== 火扩展包 ====================

export const 卧龙诸葛: CharacterConfig = {
  name: '卧龙诸葛',
  maxHealth: 3,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '八阵',
      description: '锁定技，当你没有装备防具时，始终视为你装备着【八卦阵】。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
    {
      name: '火计',
      description: '你可以将一张红色手牌当【火攻】使用。',
      trigger: 'manual',
      effect: { type: 'convert', from: '红色手牌', to: '火攻' },
    },
    {
      name: '看破',
      description: '你可以将一张黑色手牌当【无懈可击】使用。',
      trigger: 'manual',
      effect: { type: 'convert', from: '黑色手牌', to: '无懈可击' },
    },
  ],
};

export const 庞统: CharacterConfig = {
  name: '庞统',
  maxHealth: 3,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '连环',
      description: '你可以将一张梅花手牌当【铁索连环】使用或重铸。',
      trigger: 'manual',
      effect: { type: 'convert', from: '梅花手牌', to: '铁索连环' },
    },
    {
      name: '涅槃',
      description: '限定技，当你处于濒死状态时，你可以弃置所有牌和判定区的牌，重置武将牌，摸三张牌并回复至3点体力。',
      trigger: 'onDamageReceived',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

// ==================== 林扩展包 ====================

export const 孟获: CharacterConfig = {
  name: '孟获',
  maxHealth: 4,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '祸首',
      description: '锁定技，【南蛮入侵】对你无效；你是任何【南蛮入侵】造成伤害的来源。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
    {
      name: '再起',
      description: '摸牌阶段，若你已受伤，你可以放弃摸牌并展示牌堆顶X张牌（X为你已损失体力值），每有一张红桃回复1点体力，然后弃掉这些红桃牌，将其余的牌收入手牌。',
      trigger: 'onCardDrawn',
      condition: { phase: '摸牌' },
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

export const 祝融: CharacterConfig = {
  name: '祝融',
  maxHealth: 4,
  gender: '女',
  faction: '蜀',
  abilities: [
    {
      name: '巨象',
      description: '锁定技，【南蛮入侵】对你无效；若其他角色使用的【南蛮入侵】在结算完时进入弃牌堆，你立即获得它。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
    {
      name: '烈刃',
      description: '每当你使用【杀】造成伤害后，可与受伤害的角色拼点：若你赢，你获得对方的一张牌。',
      trigger: 'onDamageDealt',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

// ==================== 山扩展包 ====================

export const 姜维: CharacterConfig = {
  name: '姜维',
  maxHealth: 4,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '挑衅',
      description: '出牌阶段，你可以指定一名使用【杀】能攻击到你的角色，该角色需对你使用一张【杀】，否则你弃其一张牌。每回合限一次。',
      trigger: 'manual',
      condition: { phase: '出牌' },
      effect: { type: 'sequence', steps: [] },
      oncePerTurn: true,
    },
    {
      name: '志继',
      description: '觉醒技，回合开始阶段，若你没有手牌，你须回复1点体力或摸两张牌，然后减1点体力上限，并永久获得技能"观星"。',
      trigger: 'onTurnStart',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
  ],
};

export const 刘禅: CharacterConfig = {
  name: '刘禅',
  maxHealth: 3,
  gender: '男',
  faction: '蜀',
  abilities: [
    {
      name: '享乐',
      description: '锁定技，当其他角色使用【杀】指定你为目标时，需额外弃置一张基本牌，否则该【杀】对你无效。',
      trigger: 'onTargeted',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
    {
      name: '放权',
      description: '你可以跳过出牌阶段，然后在回合结束时弃置一张手牌，令一名其他角色进行一个额外回合。',
      trigger: 'manual',
      condition: { phase: '出牌' },
      effect: { type: 'sequence', steps: [] },
      oncePerTurn: true,
    },
    {
      name: '若愚',
      description: '主公技，觉醒技，回合开始阶段，若你的体力是全场最少的（或之一），你须增加1点体力上限并回复1点体力，然后永久获得技能"激将"。',
      trigger: 'onTurnStart',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
  ],
};

export const shuCharacters: CharacterConfig[] = [
  刘备, 关羽, 张飞, 赵云, 诸葛亮, 黄月英, 马超,
  黄忠, 魏延, 卧龙诸葛, 庞统, 孟获, 祝融, 姜维, 刘禅,
];
