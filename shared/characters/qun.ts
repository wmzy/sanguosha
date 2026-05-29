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

export const qunCharacters: CharacterConfig[] = [华佗, 吕布, 貂蝉];
