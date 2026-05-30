import { describe, it, expect } from 'vitest';
import { GameController } from '@engine/game';
import type { Card, Suit, Rank, CharacterConfig } from '@shared/types';

function makeCard(name: string, suit: Suit = '♠', rank: Rank = 'A', overrides?: Partial<Card>): Card {
  const subtypeMap: Record<string, Card['subtype']> = {
    杀: '杀', 闪: '闪', 桃: '桃',
  };
  return {
    name, type: '基本牌', subtype: subtypeMap[name] ?? '杀',
    suit, rank, description: '', id: `${name}-${suit}-${rank}`,
    ...overrides,
  };
}

function makeWeapon(name: string, range: number): Card {
  return {
    name, type: '装备牌', subtype: '武器', suit: '♠', rank: 'A',
    description: '', id: `${name}-♠-A`, range,
  };
}

function makeArmor(name: string): Card {
  return {
    name, type: '装备牌', subtype: '防具', suit: '♠', rank: 'A',
    description: '', id: `${name}-♠-A`,
  };
}

const 武圣刘备: CharacterConfig = {
  name: '刘备', maxHealth: 4, gender: '男', faction: '蜀', abilities: [],
};

const 奸雄曹操: CharacterConfig = {
  name: '曹操', maxHealth: 4, gender: '男', faction: '魏', abilities: [],
};

describe('诸葛连弩', () => {
  it('装备后杀无次数限制', () => {
    const weapon = makeWeapon('诸葛连弩', 1);
    const kill1 = makeCard('杀', '♠', '3');
    const kill2 = makeCard('杀', '♣', '5');

    const controller = GameController.createForTesting({
      players: [
        { name: '刘备', character: 武圣刘备, role: '主公', health: 4, maxHealth: 4, hand: [kill1, kill2], equipment: { weapon }, alive: true },
        { name: '曹操', character: 奸雄曹操, role: '反贼', health: 4, maxHealth: 4, hand: [], equipment: {}, alive: true },
      ],
      deck: [], discardPile: [],
      currentPlayer: '刘备', phase: '出牌', round: 1,
      status: '进行中', seed: 12345, killsPlayedThisTurn: 1, skillsUsedThisTurn: [],
    });

    const result = controller.playCard('刘备', kill2.id, '曹操');
    expect(result.success).toBe(true);
  });
});

describe('仁王盾', () => {
  it('黑色杀无效', () => {
    const armor = makeArmor('仁王盾');
    const killCard = makeCard('杀', '♠', '3');

    const controller = GameController.createForTesting({
      players: [
        { name: '刘备', character: 武圣刘备, role: '主公', health: 4, maxHealth: 4, hand: [killCard], equipment: {}, alive: true },
        { name: '曹操', character: 奸雄曹操, role: '反贼', health: 4, maxHealth: 4, hand: [], equipment: { armor }, alive: true },
      ],
      deck: [], discardPile: [],
      currentPlayer: '刘备', phase: '出牌', round: 1,
      status: '进行中', seed: 12345, killsPlayedThisTurn: 0, skillsUsedThisTurn: [],
    });

    const playResult = controller.playCard('刘备', killCard.id, '曹操');
    expect(playResult.success).toBe(true);
    expect(playResult.responseWindow).toBeDefined();

    const responses = new Map<string, Card | null>();
    responses.set('曹操', null);
    const result = controller.respondToWindow(responses);

    const caocao = result.state.players.find(p => p.name === '曹操')!;
    expect(caocao.health).toBe(4);
  });

  it('红色杀正常命中', () => {
    const armor = makeArmor('仁王盾');
    const killCard = makeCard('杀', '♥', '3');

    const controller = GameController.createForTesting({
      players: [
        { name: '刘备', character: 武圣刘备, role: '主公', health: 4, maxHealth: 4, hand: [killCard], equipment: {}, alive: true },
        { name: '曹操', character: 奸雄曹操, role: '反贼', health: 4, maxHealth: 4, hand: [], equipment: { armor }, alive: true },
      ],
      deck: [], discardPile: [],
      currentPlayer: '刘备', phase: '出牌', round: 1,
      status: '进行中', seed: 12345, killsPlayedThisTurn: 0, skillsUsedThisTurn: [],
    });

    const playResult = controller.playCard('刘备', killCard.id, '曹操');
    expect(playResult.success).toBe(true);

    const responses = new Map<string, Card | null>();
    responses.set('曹操', null);
    const result = controller.respondToWindow(responses);

    const caocao = result.state.players.find(p => p.name === '曹操')!;
    expect(caocao.health).toBe(3);
  });
});

describe('八卦阵', () => {
  it('红色判定自动闪避', () => {
    const armor = makeArmor('八卦阵');
    const killCard = makeCard('杀', '♠', '3');
    const judgeCard = makeCard('杀', '♥', '7');

    const controller = GameController.createForTesting({
      players: [
        { name: '刘备', character: 武圣刘备, role: '主公', health: 4, maxHealth: 4, hand: [killCard], equipment: {}, alive: true },
        { name: '曹操', character: 奸雄曹操, role: '反贼', health: 4, maxHealth: 4, hand: [], equipment: { armor }, alive: true },
      ],
      deck: [judgeCard], discardPile: [],
      currentPlayer: '刘备', phase: '出牌', round: 1,
      status: '进行中', seed: 12345, killsPlayedThisTurn: 0, skillsUsedThisTurn: [],
    });

    const playResult = controller.playCard('刘备', killCard.id, '曹操');
    expect(playResult.success).toBe(true);

    const responses = new Map<string, Card | null>();
    responses.set('曹操', null);
    const result = controller.respondToWindow(responses);

    const caocao = result.state.players.find(p => p.name === '曹操')!;
    expect(caocao.health).toBe(4);
  });

  it('黑色判定判定失败受伤', () => {
    const armor = makeArmor('八卦阵');
    const killCard = makeCard('杀', '♠', '3');
    const judgeCard = makeCard('杀', '♣', '7');

    const controller = GameController.createForTesting({
      players: [
        { name: '刘备', character: 武圣刘备, role: '主公', health: 4, maxHealth: 4, hand: [killCard], equipment: {}, alive: true },
        { name: '曹操', character: 奸雄曹操, role: '反贼', health: 4, maxHealth: 4, hand: [], equipment: { armor }, alive: true },
      ],
      deck: [judgeCard], discardPile: [],
      currentPlayer: '刘备', phase: '出牌', round: 1,
      status: '进行中', seed: 12345, killsPlayedThisTurn: 0, skillsUsedThisTurn: [],
    });

    const playResult = controller.playCard('刘备', killCard.id, '曹操');
    expect(playResult.success).toBe(true);

    const responses = new Map<string, Card | null>();
    responses.set('曹操', null);
    const result = controller.respondToWindow(responses);

    const caocao = result.state.players.find(p => p.name === '曹操')!;
    expect(caocao.health).toBe(3);
  });
});
