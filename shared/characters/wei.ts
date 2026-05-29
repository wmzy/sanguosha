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

export const weiCharacters: CharacterConfig[] = [曹操, 司马懿, 夏侯惇, 张辽, 许褚, 郭嘉, 甄姬];
