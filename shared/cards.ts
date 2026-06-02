// shared/cards.ts — v1 卡牌数据（带 suit/rank/description 的完整 Card 实例）
//
// 注意：这是 v1 引擎的卡牌数据，被测试工具（scenario-runner）和
// tests/unit/cards-ext.test.ts 引用作为发牌模板。v2 引擎使用
// `shared/cards/` 目录下的 CardDef 声明式定义，并通过
// `shared/deck.ts` 的 createStandardDeck() 在运行时生成卡实例。
// 两者服务不同目的，请勿删除此文件。

import type { Card, Suit, Rank } from './types';

// ============================================================
// 武器牌定义
// ============================================================

export const 诸葛连弩: Card = {
  id: '',
  name: '诸葛连弩',
  type: '装备牌',
  subtype: '武器',
  suit: '♠',
  rank: 'A',
  description: '攻击范围1。出牌阶段，你可以使用任意数量的【杀】。',
  range: 1,
};

export const 青釭剑: Card = {
  id: '',
  name: '青釭剑',
  type: '装备牌',
  subtype: '武器',
  suit: '♠',
  rank: '6',
  description: '攻击范围2。锁定技，你使用的【杀】无视目标防具。',
  range: 2,
};

export const 雌雄双股剑: Card = {
  id: '',
  name: '雌雄双股剑',
  type: '装备牌',
  subtype: '武器',
  suit: '♠',
  rank: '2',
  description: '攻击范围2。你使用【杀】指定异性角色为目标后，令其选择一项：弃置一张手牌，或令你摸一张牌。',
  range: 2,
};

export const 贯石斧: Card = {
  id: '',
  name: '贯石斧',
  type: '装备牌',
  subtype: '武器',
  suit: '♠',
  rank: '5',
  description: '攻击范围3。目标角色使用【闪】后，你可以弃置两张牌，令此【杀】依然造成伤害。',
  range: 3,
};

export const 青龙偃月刀: Card = {
  id: '',
  name: '青龙偃月刀',
  type: '装备牌',
  subtype: '武器',
  suit: '♠',
  rank: '5',
  description: '攻击范围3。你使用的【杀】被【闪】抵消后，你可以对相同目标再使用一张【杀】。',
  range: 3,
};

export const 丈八蛇矛: Card = {
  id: '',
  name: '丈八蛇矛',
  type: '装备牌',
  subtype: '武器',
  suit: '♠',
  rank: 'Q',
  description: '攻击范围3。你可以将两张手牌当【杀】使用或打出。',
  range: 3,
};

export const 方天画戟: Card = {
  id: '',
  name: '方天画戟',
  type: '装备牌',
  subtype: '武器',
  suit: '♦',
  rank: 'Q',
  description: '攻击范围4。当你使用【杀】时，若此【杀】是你最后一张手牌，你可以为此【杀】额外指定至多两个目标。',
  range: 4,
};

export const 麒麟弓: Card = {
  id: '',
  name: '麒麟弓',
  type: '装备牌',
  subtype: '武器',
  suit: '♥',
  rank: '5',
  description: '攻击范围5。你使用【杀】对目标角色造成伤害时，你可以弃置其一张坐骑牌。',
  range: 5,
};

export const 八卦阵: Card = {
  id: '',
  name: '八卦阵',
  type: '装备牌',
  subtype: '防具',
  suit: '♠',
  rank: '2',
  description: '当你需要使用或打出一张【闪】时，你可以进行判定：若结果为红色，视为你使用或打出了一张【闪】。',
};

export const 仁王盾: Card = {
  id: '',
  name: '仁王盾',
  type: '装备牌',
  subtype: '防具',
  suit: '♣',
  rank: '2',
  description: '锁定技，黑色的【杀】对你无效。',
};

export const 绝影: Card = {
  id: '',
  name: '绝影',
  type: '装备牌',
  subtype: '防御马',
  suit: '♠',
  rank: '5',
  description: '其他角色计算与你的距离时，始终+1。',
};

export const 爪黄飞电: Card = {
  id: '',
  name: '爪黄飞电',
  type: '装备牌',
  subtype: '防御马',
  suit: '♠',
  rank: 'K',
  description: '其他角色计算与你的距离时，始终+1。',
};

export const 的卢: Card = {
  id: '',
  name: '的卢',
  type: '装备牌',
  subtype: '防御马',
  suit: '♠',
  rank: 'K',
  description: '其他角色计算与你的距离时，始终+1。',
};

export const 赤兔: Card = {
  id: '',
  name: '赤兔',
  type: '装备牌',
  subtype: '进攻马',
  suit: '♥',
  rank: '5',
  description: '你计算与其他角色的距离时，始终-1。',
};

export const 紫骍: Card = {
  id: '',
  name: '紫骍',
  type: '装备牌',
  subtype: '进攻马',
  suit: '♦',
  rank: 'K',
  description: '你计算与其他角色的距离时，始终-1。',
};

export const 大宛: Card = {
  id: '',
  name: '大宛',
  type: '装备牌',
  subtype: '进攻马',
  suit: '♠',
  rank: 'K',
  description: '你计算与其他角色的距离时，始终-1。',
};

export const weapons: Card[] = [
  诸葛连弩, 青釭剑, 雌雄双股剑, 贯石斧,
  青龙偃月刀, 丈八蛇矛, 方天画戟, 麒麟弓,
];

export const armors: Card[] = [八卦阵, 仁王盾];

export const horses: Card[] = [
  绝影, 爪黄飞电, 的卢, 赤兔, 紫骍, 大宛,
];

// ============================================================
// 锦囊牌定义
// ============================================================

// 普通锦囊 - 单目标
export const 过河拆桥: Card = {
  id: '',
  name: '过河拆桥',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♠',
  rank: '3',
  description: '出牌阶段，对一名其他角色使用。你选择该角色的一张牌并弃置之。',
  trickSubtype: '普通锦囊',
};

export const 顺手牵羊: Card = {
  id: '',
  name: '顺手牵羊',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♠',
  rank: '3',
  description: '出牌阶段，对距离1以内的一名其他角色使用。你选择该角色的一张牌并获得之。',
  trickSubtype: '普通锦囊',
};

export const 决斗: Card = {
  id: '',
  name: '决斗',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♠',
  rank: 'A',
  description: '出牌阶段，对一名其他角色使用。由该角色开始，你与其轮流打出一张【杀】，首先不打出【杀】的角色受到1点伤害。',
  trickSubtype: '普通锦囊',
};

export const 无中生有: Card = {
  id: '',
  name: '无中生有',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♥',
  rank: '7',
  description: '出牌阶段，对你自己使用。你摸两张牌。',
  trickSubtype: '普通锦囊',
};

// 普通锦囊 - 全体
export const 万箭齐发: Card = {
  id: '',
  name: '万箭齐发',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♠',
  rank: 'A',
  description: '出牌阶段，对所有其他角色使用。每名目标角色需打出一张【闪】，否则受到1点伤害。',
  trickSubtype: '普通锦囊',
};

export const 南蛮入侵: Card = {
  id: '',
  name: '南蛮入侵',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♠',
  rank: '7',
  description: '出牌阶段，对所有其他角色使用。每名目标角色需打出一张【杀】，否则受到1点伤害。',
  trickSubtype: '普通锦囊',
};

export const 桃园结义: Card = {
  id: '',
  name: '桃园结义',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♥',
  rank: 'A',
  description: '出牌阶段，对所有角色使用。每名目标角色回复1点体力。',
  trickSubtype: '普通锦囊',
};

export const 五谷丰登: Card = {
  id: '',
  name: '五谷丰登',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♥',
  rank: '3',
  description: '出牌阶段，对所有角色使用。你从牌堆顶亮出等同于角色数量的牌，每名目标角色获得其中一张。',
  trickSubtype: '普通锦囊',
};

export const normalTricks: Card[] = [
  过河拆桥, 顺手牵羊, 决斗, 无中生有,
  万箭齐发, 南蛮入侵, 桃园结义, 五谷丰登,
];

// 延时锦囊
export const 乐不思蜀: Card = {
  id: '',
  name: '乐不思蜀',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♠',
  rank: '6',
  description: '出牌阶段，对距离1以内的一名其他角色使用。判定阶段，该角色进行判定，若结果不为♥，则跳过其出牌阶段。',
  trickSubtype: '延时锦囊',
};

export const 兵粮寸断: Card = {
  id: '',
  name: '兵粮寸断',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♣',
  rank: '10',
  description: '出牌阶段，对距离1以内的一名其他角色使用。判定阶段，该角色进行判定，若结果不为♣，则跳过其摸牌阶段。',
  trickSubtype: '延时锦囊',
};

export const 闪电: Card = {
  id: '',
  name: '闪电',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♠',
  rank: 'A',
  description: '判定阶段，你进行判定，若结果为♠2~9，你受到3点雷电伤害，然后弃置此牌。',
  trickSubtype: '延时锦囊',
};

export const delayedTricks: Card[] = [乐不思蜀, 兵粮寸断, 闪电];

// 响应锦囊
export const 无懈可击: Card = {
  id: '',
  name: '无懈可击',
  type: '锦囊牌',
  subtype: '锦囊',
  suit: '♠',
  rank: 'K',
  description: '在一张锦囊牌对目标角色生效前，对此锦囊使用。抵消此锦囊牌对该角色的效果。',
  trickSubtype: '响应锦囊',
};

export const reactiveTricks: Card[] = [无懈可击];

// 所有锦囊
export const allTricks: Card[] = [
  ...normalTricks,
  ...delayedTricks,
  ...reactiveTricks,
];

// ============================================================
// 创建一副标准牌堆（含装备和锦囊）
// ============================================================

export function createDeck(): Card[] {
  const deck: Card[] = [];
  let counter = 0;

  const add = (card: Omit<Card, 'id'>): Card => {
    const withId = { ...card, id: `${card.name}-${card.suit}-${card.rank}-${counter++}` };
    deck.push(withId);
    return withId;
  };

  // 基本牌
  // 杀: ♠3-7, ♣3-7, ♥10-11, ♦6-10
  const killSuits: [Suit, Rank][] = [
    ['♠', '3'], ['♠', '4'], ['♠', '5'], ['♠', '6'], ['♠', '7'],
    ['♣', '3'], ['♣', '4'], ['♣', '5'], ['♣', '6'], ['♣', '7'],
    ['♥', '10'], ['♥', 'J'],
    ['♦', '6'], ['♦', '7'], ['♦', '8'], ['♦', '9'], ['♦', '10'],
  ];

  for (const [suit, rank] of killSuits) {
    add({
      name: '杀',
      type: '基本牌',
      subtype: '杀',
      suit,
      rank,
      description: '出牌阶段，对攻击范围内的一名角色使用。其须使用一张【闪】，否则受到1点伤害。',
    });
  }

  // 闪: ♥3-6, ♦10-K
  const dodgeSuits: [Suit, Rank][] = [
    ['♥', '3'], ['♥', '4'], ['♥', '5'], ['♥', '6'],
    ['♦', '10'], ['♦', 'J'], ['♦', 'Q'], ['♦', 'K'],
  ];

  for (const [suit, rank] of dodgeSuits) {
    add({
      name: '闪',
      type: '基本牌',
      subtype: '闪',
      suit,
      rank,
      description: '当你成为【杀】的目标时，你可以使用一张【闪】来抵消此【杀】。',
    });
  }

  // 桃: ♥7-9, ♣12
  const peachSuits: [Suit, Rank][] = [
    ['♥', '7'], ['♥', '8'], ['♥', '9'],
    ['♣', 'Q'],
  ];

  for (const [suit, rank] of peachSuits) {
    add({
      name: '桃',
      type: '基本牌',
      subtype: '桃',
      suit,
      rank,
      description: '出牌阶段，对自己使用。回复1点体力。',
    });
  }

  // 装备牌 - 每种各1张
  const allEquip = [...weapons, ...armors, ...horses];
  for (const equip of allEquip) {
    add(equip);
  }

  // 锦囊牌
  for (const trick of allTricks) {
    add(trick);
  }

  return deck;
}

// ============================================================
// 卡牌分类辅助函数
// ============================================================

export function isWeapon(card: Card): boolean {
  return card.subtype === '武器';
}

export function isArmor(card: Card): boolean {
  return card.subtype === '防具';
}

export function isHorse(card: Card): boolean {
  return card.subtype === '进攻马' || card.subtype === '防御马';
}

export function isEquipment(card: Card): boolean {
  return card.type === '装备牌';
}

export function isTrick(card: Card): boolean {
  return card.type === '锦囊牌';
}

export function isDelayedTrick(card: Card): boolean {
  return card.trickSubtype === '延时锦囊';
}

export function isBlackSuit(card: Card): boolean {
  return card.suit === '♠' || card.suit === '♣';
}

export function isRedSuit(card: Card): boolean {
  return card.suit === '♥' || card.suit === '♦';
}
