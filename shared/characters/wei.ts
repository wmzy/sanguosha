import type { CharacterConfig } from '../types';

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
      effect: { type: '获得', source: 'damageSourceCard' },
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
      effect: { type: '获得', source: 'attacker', count: 1 },
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
          { type: '判定', expectedSuit: '♥', onFail: { type: '弃置', count: 2, target: 'attacker' } },
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
        { type: '获得', source: 'otherPlayers', count: 2 },
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
      ] },
      modifiers: ['裸衣Bonus'],
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
      effect: { type: '获得', source: 'judgeCard' },
      passive: true,
    },
    {
      name: '遗计',
      description: '当你受到1点伤害后，你可以摸两张牌。',
      trigger: 'onDamageReceived',
      effect: { type: '摸牌', count: 2 },
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
        { type: '判定', repeatOnBlack: true },
        { type: '获得', source: 'judgeCard' },
      ] },
    },
  ],
};

// ==================== 风扩展包 ====================

export const 夏侯渊: CharacterConfig = {
  name: '夏侯渊',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '神速',
      description: '你可以选择以下一至两项：1.跳过判定阶段和摸牌阶段；2.跳过出牌阶段并弃置一张装备牌。你每选择一项，视为对一名其他角色使用一张无距离限制的【杀】。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

export const 曹仁: CharacterConfig = {
  name: '曹仁',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '据守',
      description: '结束阶段，你可以翻面并摸三张牌，然后跳过你的下一回合。',
      trigger: 'onTurnStart',
      condition: { phase: '结束' },
      effect: { type: 'sequence', steps: [
        { type: '摸牌', count: 3 },
      ] },
    },
  ],
};

// ==================== 火扩展包 ====================

export const 荀彧: CharacterConfig = {
  name: '荀彧',
  maxHealth: 3,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '驱虎',
      description: '出牌阶段，你可以与一名角色拼点，若你赢，该角色对其攻击范围内另一名角色造成1点伤害；若你没赢，该角色对你造成1点伤害。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
    },
    {
      name: '节命',
      description: '当你受到1点伤害后，你可以令一名角色将手牌摸至X张（X为其体力上限且最多为5）。',
      trigger: 'onDamageReceived',
      effect: { type: '摸牌', count: 'upToMaxHealth' },
      passive: true,
    },
  ],
};

export const 典韦: CharacterConfig = {
  name: '典韦',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '强袭',
      description: '出牌阶段，你可以自减1点体力或弃一张武器牌，对攻击范围内的一名角色造成1点伤害。每回合限一次。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

// ==================== 林扩展包 ====================

export const 曹丕: CharacterConfig = {
  name: '曹丕',
  maxHealth: 3,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '行殇',
      description: '你可以立即获得死亡角色的所有牌。',
      trigger: 'onDeath',
      effect: { type: '获得', source: 'selected', count: 99 },
      passive: true,
    },
    {
      name: '放逐',
      description: '每当你受到一次伤害后，可以令除你以外的任一角色补X张牌（X为你已损失体力值），然后该角色将其武将牌翻面。',
      trigger: 'onDamageReceived',
      effect: { type: 'sequence', steps: [
        { type: '摸牌', count: 'lostHealth' },
      ] },
      passive: true,
    },
    {
      name: '颂威',
      description: '其他魏势力角色的判定牌结果为黑色且生效后，可以让你摸一张牌。',
      trigger: 'onJudge',
      effect: { type: '摸牌', count: 1 },
    },
  ],
};

export const 徐晃: CharacterConfig = {
  name: '徐晃',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '断粮',
      description: '你可以将一张黑色的基本牌或黑色装备牌当【兵粮寸断】使用；你对手牌数不小于你的角色使用【兵粮寸断】无距离限制。',
      trigger: 'manual',
      effect: { type: 'convert', from: 'blackBasicOrEquip', to: '兵粮寸断' },
    },
  ],
};

// ==================== 山扩展包 ====================

export const 张郃: CharacterConfig = {
  name: '张郃',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '巧变',
      description: '你可以弃置一张手牌来跳过自己的一个阶段（回合开始和回合结束阶段除外）。若以此法跳过摸牌阶段，你从至多两名其他角色处各获得一张手牌；若以此法跳过出牌阶段，你可以将场上的一张牌移动到另一个合理的位置。',
      trigger: 'onTurnStart',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

export const 邓艾: CharacterConfig = {
  name: '邓艾',
  maxHealth: 4,
  gender: '男',
  faction: '魏',
  abilities: [
    {
      name: '屯田',
      description: '每次当你于回合外失去牌时，可进行一次判定，将非红桃的判定牌置于你的武将牌上，称为"田"；每有一张田，你计算与其他角色的距离便减少1。',
      trigger: 'onCardPlayed',
      effect: { type: 'sequence', steps: [
        { type: '判定', condition: 'notHeart' },
      ] },
      passive: true,
    },
    {
      name: '凿险',
      description: '准备阶段，若"田"的数量≥3，你须减1点体力上限，然后获得技能"急袭"（你可以将一张"田"当【顺手牵羊】使用）。',
      trigger: 'onTurnStart',
      condition: { phase: '准备' },
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

export const weiCharacters: CharacterConfig[] = [
  曹操, 司马懿, 夏侯惇, 张辽, 许褚, 郭嘉, 甄姬,
  夏侯渊, 曹仁, 荀彧, 典韦, 曹丕, 徐晃, 张郃, 邓艾,
];
