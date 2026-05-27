import type { CharacterConfig } from './类型';

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

export const 所有角色: CharacterConfig[] = [曹操, 刘备, 孙权];
