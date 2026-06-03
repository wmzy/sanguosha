import type { CharacterConfig } from '../types';

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

// ==================== 风扩展包 ====================

export const 张角: CharacterConfig = {
  name: '张角',
  maxHealth: 3,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '雷击',
      description: '当你使用或打出【闪】时，可令任意一名角色判定，若结果为黑桃，你对该角色造成2点雷电伤害。',
      trigger: 'onCardPlayed',
      effect: { type: 'sequence', steps: [
        { type: 'judge', condition: 'spade', onFail: { type: 'damage', amount: 2, damageType: '雷电' } },
      ] },
    },
    {
      name: '鬼道',
      description: '当一名角色的判定牌生效前，你可以用一张黑色牌替换之。',
      trigger: 'onJudge',
      effect: { type: 'sequence', steps: [] },
    },
    {
      name: '黄天',
      description: '主公技，其他群势力角色可以在其出牌阶段将一张【闪】或【闪电】交给你。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
  ],
};

export const 于吉: CharacterConfig = {
  name: '于吉',
  maxHealth: 3,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '蛊惑',
      description: '你可以扣置一张手牌当作任意一张牌使用或打出。其他角色可质疑并翻开此牌，若为假则双方各受牵连，若为真则质疑者扣减体力。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

// ==================== 火扩展包 ====================

export const 袁绍: CharacterConfig = {
  name: '袁绍',
  maxHealth: 4,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '乱击',
      description: '你可以将两张同花色手牌当【万箭齐发】使用。',
      trigger: 'manual',
      condition: { phase: '出牌', hasHandCards: true },
      effect: { type: 'convert', from: 'sameSuitPair', to: '万箭齐发' },
    },
  ],
};

export const 庞德: CharacterConfig = {
  name: '庞德',
  maxHealth: 4,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '马术',
      description: '锁定技，你计算与其他角色的距离时始终-1。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
      passive: true,
      modifiers: ['distanceMinus1'],
    },
    {
      name: '鞬出',
      description: '当你使用【杀】指定一名角色为目标后，你可以弃置其一张牌，若弃置的牌为装备牌，其不能使用【闪】；若不为装备牌，其获得此【杀】。',
      trigger: 'onCardPlayed',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

export const 颜良文丑: CharacterConfig = {
  name: '颜良文丑',
  maxHealth: 4,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '双雄',
      description: '摸牌阶段，你可以放弃摸牌，改为展示牌堆顶两张牌并选择其中一张，然后本回合你可以将一张与此牌同花色的手牌当【决斗】使用。',
      trigger: 'onTurnStart',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

// ==================== 林扩展包 ====================

export const 董卓: CharacterConfig = {
  name: '董卓',
  maxHealth: 8,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '酒池',
      description: '你可以将一张黑桃手牌当【酒】使用。',
      trigger: 'manual',
      effect: { type: 'convert', from: 'spadeHandCard', to: '酒' },
    },
    {
      name: '肉林',
      description: '锁定技，你对女性角色/女性角色对你使用【杀】时，需连续使用两张【闪】才能抵消。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
    {
      name: '崩坏',
      description: '锁定技，回合结束阶段，若你的体力不是全场最少的（或同时为最少），你须减1点体力或1点体力上限。',
      trigger: 'onTurnEnd',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
    {
      name: '暴虐',
      description: '主公技，其他群雄角色每造成一次伤害，可进行一次判定，若结果为黑桃，你回复1点体力。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
  ],
};

export const 贾诩: CharacterConfig = {
  name: '贾诩',
  maxHealth: 3,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '完杀',
      description: '锁定技，在你的回合，除你以外，只有处于濒死状态的角色才能使用【桃】。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
    {
      name: '乱武',
      description: '限定技，出牌阶段，你可以令所有其他角色依次对与其距离最近的另一名角色使用一张【杀】，无法如此做者失去1点体力。',
      trigger: 'manual',
      condition: { phase: '出牌' },
      effect: { type: 'sequence', steps: [] },
    },
    {
      name: '帷幕',
      description: '锁定技，你不能成为黑色锦囊的目标。',
      trigger: 'manual',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
  ],
};

// ==================== 山扩展包 ====================

export const 左慈: CharacterConfig = {
  name: '左慈',
  maxHealth: 3,
  gender: '男',
  faction: '群',
  abilities: [
    {
      name: '化身',
      description: '游戏开始时，你随机获得两张未登场的武将牌作为化身牌，然后亮出其中一张，你获得该化身牌上的一个技能（限定技、觉醒技、主公技除外）。回合开始或结束时，你可以更改化身牌。',
      trigger: 'onTurnStart',
      effect: { type: 'sequence', steps: [] },
    },
    {
      name: '新生',
      description: '每当你受到1点伤害后，你可以获得一张新的化身牌。',
      trigger: 'onDamageReceived',
      effect: { type: 'sequence', steps: [] },
    },
  ],
};

export const 蔡文姬: CharacterConfig = {
  name: '蔡文姬',
  maxHealth: 3,
  gender: '女',
  faction: '群',
  abilities: [
    {
      name: '悲歌',
      description: '当一名角色受到【杀】造成的伤害后，你可以弃置一张牌，然后令该角色判定，根据判定结果执行效果。',
      trigger: 'onDamageReceived',
      effect: { type: 'sequence', steps: [] },
    },
    {
      name: '断肠',
      description: '锁定技，杀死你的角色立即失去所有技能直到游戏结束。',
      trigger: 'onDeath',
      effect: { type: 'sequence', steps: [] },
      passive: true,
    },
  ],
};

export const qunCharacters: CharacterConfig[] = [华佗, 吕布, 貂蝉, 张角, 于吉, 袁绍, 庞德, 颜良文丑, 董卓, 贾诩, 左慈, 蔡文姬];
