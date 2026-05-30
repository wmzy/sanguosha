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

export const shuCharacters: CharacterConfig[] = [刘备, 关羽, 张飞, 赵云, 诸葛亮, 黄月英, 马超];
