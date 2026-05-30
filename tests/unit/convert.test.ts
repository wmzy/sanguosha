import { describe, it, expect } from 'vitest';
import { getConversionOptions, getConversionTargets } from '@engine/convert';
import type { Player, CharacterConfig, Card, Suit, Rank } from '@shared/types';

function makeCard(name: string, suit: Suit = '♠', rank: Rank = 'A'): Card {
  return {
    name, type: '基本牌', subtype: name === '闪' ? '闪' : name === '桃' ? '桃' : '杀',
    suit, rank, description: '', id: `${name}-${suit}-${rank}`,
  };
}

function makeCharacter(abilities: CharacterConfig['abilities']): CharacterConfig {
  return { name: '测试角色', maxHealth: 4, gender: '男', faction: '魏', abilities };
}

function makePlayer(hand: Card[], abilities: CharacterConfig['abilities'] = []): Player {
  return {
    name: '测试', character: makeCharacter(abilities), role: '主公',
    health: 4, maxHealth: 4, hand, equipment: {}, alive: true,
  };
}

describe('getConversionOptions', () => {
  it('黑色手牌可当闪使用', () => {
    const blackCard = makeCard('杀', '♠');
    const player = makePlayer([blackCard], [
      { name: '倾国', description: '', trigger: 'manual', effect: { type: 'convert', from: 'blackHandCard', to: '闪' } },
    ]);

    const options = getConversionOptions(player, '闪', 'response');
    expect(options).toHaveLength(1);
    expect(options[0].convertedCard.name).toBe('闪');
    expect(options[0].originalCard.id).toBe(blackCard.id);
  });

  it('红色手牌可当杀使用', () => {
    const redCard = makeCard('闪', '♥');
    const player = makePlayer([redCard], [
      { name: '武圣', description: '', trigger: 'manual', effect: { type: 'convert', from: 'redHandCard', to: '杀' } },
    ]);

    const options = getConversionOptions(player, '杀', 'play');
    expect(options).toHaveLength(1);
    expect(options[0].convertedCard.name).toBe('杀');
  });

  it('♦手牌可当乐不思蜀使用', () => {
    const diamondCard = makeCard('杀', '♦');
    const player = makePlayer([diamondCard], [
      { name: '国色', description: '', trigger: 'manual', effect: { type: 'convert', from: '♦handCard', to: '乐不思蜀' } },
    ]);

    const options = getConversionOptions(player, '乐不思蜀', 'play');
    expect(options).toHaveLength(1);
    expect(options[0].convertedCard.name).toBe('乐不思蜀');
  });

  it('红色手牌可当桃使用', () => {
    const redCard = makeCard('杀', '♥');
    const player = makePlayer([redCard], [
      { name: '急救', description: '', trigger: 'manual', effect: { type: 'convert', from: 'redHandCard', to: '桃' } },
    ]);

    const options = getConversionOptions(player, '桃', 'response');
    expect(options).toHaveLength(1);
    expect(options[0].convertedCard.name).toBe('桃');
  });

  it('赵云杀闪互转 — 闪转杀', () => {
    const dodge = makeCard('闪', '♦');
    const player = makePlayer([dodge], [
      { name: '龙胆', description: '', trigger: 'manual', effect: { type: 'convert', from: '杀闪互转', to: '杀闪互转' } },
    ]);

    const options = getConversionOptions(player, '杀', 'play');
    expect(options).toHaveLength(1);
    expect(options[0].convertedCard.name).toBe('杀');
  });

  it('赵云杀闪互转 — 杀转闪', () => {
    const kill = makeCard('杀', '♠');
    const player = makePlayer([kill], [
      { name: '龙胆', description: '', trigger: 'manual', effect: { type: 'convert', from: '杀闪互转', to: '杀闪互转' } },
    ]);

    const options = getConversionOptions(player, '闪', 'response');
    expect(options).toHaveLength(1);
    expect(options[0].convertedCard.name).toBe('闪');
  });

  it('没有转换技能时返回空', () => {
    const player = makePlayer([makeCard('杀', '♠')]);
    const options = getConversionOptions(player, '闪', 'response');
    expect(options).toHaveLength(0);
  });

  it('不匹配的花色不转换', () => {
    const redCard = makeCard('杀', '♥');
    const player = makePlayer([redCard], [
      { name: '倾国', description: '', trigger: 'manual', effect: { type: 'convert', from: 'blackHandCard', to: '闪' } },
    ]);

    const options = getConversionOptions(player, '闪', 'response');
    expect(options).toHaveLength(0);
  });

  it('passive 技能不参与转换', () => {
    const blackCard = makeCard('杀', '♠');
    const player = makePlayer([blackCard], [
      { name: '测试', description: '', trigger: 'manual', effect: { type: 'convert', from: 'blackHandCard', to: '闪' }, passive: true },
    ]);

    const options = getConversionOptions(player, '闪', 'response');
    expect(options).toHaveLength(0);
  });
});

describe('getConversionTargets', () => {
  it('返回所有可转换的目标', () => {
    const blackCard = makeCard('杀', '♠');
    const player = makePlayer([blackCard], [
      { name: '奇袭', description: '', trigger: 'manual', effect: { type: 'convert', from: 'blackHandCard', to: '过河拆桥' } },
    ]);

    const targets = getConversionTargets(player, 'play');
    expect(targets).toHaveLength(1);
    expect(targets[0].convertedCard.name).toBe('过河拆桥');
  });
});
