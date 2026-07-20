// tests/engine/deck-composition.test.ts
// 标准包(108) + 军争篇(52) = 160 张牌堆花色点数组成断言。
//
// 数据源:BWIKI「标准包卡牌」「军争篇卡牌」牌堆构成表。
//   https://wiki.biligame.com/sgs/标准包卡牌
//   https://wiki.biligame.com/sgs/军争篇卡牌
//
// 用途:防止 deck.ts 退化回旧的「算法循环生成」实现(花色点数与官方不符)。
// 一旦有人改回 add(name,count) 循环,这里的精确花色点数断言会立即失败。
//
// 归并建议:牌堆组成属引擎核心不变量,本文件为独立断言集,不并入 skill-tests。

import { describe, it, expect } from 'vitest';
import { createStandardDeck } from '../../src/shared/deck';
import type { Suit } from '../../src/shared/types';

const FULL_DECK = createStandardDeck();

/** 统计指定 (花色,点数) 在牌堆中出现的次数 */
function countAt(suit: Suit, rank: string): number {
  return FULL_DECK.filter((c) => c.suit === suit && c.rank === rank).length;
}

/** 统计某牌名在牌堆中的张数 */
function countName(name: string): number {
  return FULL_DECK.filter((c) => c.name === name).length;
}

/** 列出某牌名在牌堆中所有出现位置的 (花色,点数) */
function locations(name: string): Array<{ suit: Suit; rank: string }> {
  return FULL_DECK.filter((c) => c.name === name).map((c) => ({ suit: c.suit, rank: c.rank }));
}

describe('牌堆总数', () => {
  it('标准包 + 军争篇 = 160 张', () => {
    expect(FULL_DECK.length).toBe(160);
  });

  it('每张牌 id 唯一', () => {
    const ids = new Set(FULL_DECK.map((c) => c.id));
    expect(ids.size).toBe(FULL_DECK.length);
  });
});

describe('基本牌张数(标准包+军争篇合计)', () => {
  // 标准包:杀30(全普通)、闪15、桃8;军争篇:火杀5、雷杀9、酒5、桃4、闪9
  // 合计:杀44(30普通+5火+9雷)、闪24、桃12、酒5
  it('杀 总计 44 张(30 普通杀 + 5 火杀 + 9 雷杀)', () => {
    expect(countName('杀')).toBe(44);
    const normal = FULL_DECK.filter((c) => c.name === '杀' && !c.damageType).length;
    const fire = FULL_DECK.filter((c) => c.name === '杀' && c.damageType === '火焰').length;
    const thunder = FULL_DECK.filter((c) => c.name === '杀' && c.damageType === '雷电').length;
    expect(normal).toBe(30);
    expect(fire).toBe(5);
    expect(thunder).toBe(9);
  });

  it('闪 总计 24 张(标准15 + 军争9)', () => {
    expect(countName('闪')).toBe(24);
  });

  it('桃 总计 12 张(标准8 + 军争4)', () => {
    expect(countName('桃')).toBe(12);
  });
});

describe('标准包关键花色点数(精确对应,防退化)', () => {
  // 牌堆前 108 张为标准包,后 52 张为军争篇(deck.ts 声明顺序)。
  const STANDARD_ONLY = FULL_DECK.slice(0, 108);
  const JUNZHENG_ONLY = FULL_DECK.slice(108);
  function stdCountAt(suit: Suit, rank: string): number {
    return STANDARD_ONLY.filter((c) => c.suit === suit && c.rank === rank).length;
  }
  function junCountAt(suit: Suit, rank: string): number {
    return JUNZHENG_ONLY.filter((c) => c.suit === suit && c.rank === rank).length;
  }

  // 抽样验证几张有代表性的牌,确保花色点数与官方表一致。
  it('♥A = 桃园结义 + 万箭齐发(各1张)', () => {
    expect(locations('桃园结义')).toEqual([{ suit: '♥', rank: 'A' }]);
    expect(locations('万箭齐发')).toEqual([{ suit: '♥', rank: 'A' }]);
  });

  it('♠2 = 雌雄双股剑 + 八卦阵 + 寒冰剑(EX) 共3张(标准包内)', () => {
    expect(stdCountAt('♠', '2')).toBe(3);
    const names = STANDARD_ONLY.filter(
      (c) => c.suit === '♠' && c.rank === '2',
    ).map((c) => c.name);
    expect(names.sort()).toEqual(['八卦阵', '寒冰剑', '雌雄双股剑'].sort());
  });

  it('♥Q = 桃 + 过河拆桥 + 闪电(EX) 共3张(标准包内)', () => {
    expect(stdCountAt('♥', 'Q')).toBe(3);
  });

  it('♦Q = 桃 + 方天画戟 + 无懈可击(EX) 共3张(标准包内)', () => {
    expect(stdCountAt('♦', 'Q')).toBe(3);
  });

  it('♣2 = 杀 + 八卦阵 + 仁王盾(EX) 共3张(标准包内)', () => {
    expect(stdCountAt('♣', '2')).toBe(3);
  });

  it('丈八蛇矛 = ♠Q', () => {
    expect(locations('丈八蛇矛')).toEqual([{ suit: '♠', rank: 'Q' }]);
  });

  it('诸葛连弩 = ♦A + ♣A 共2张', () => {
    const locs = locations('诸葛连弩').map((l) => `${l.suit}${l.rank}`);
    expect(locs.sort()).toEqual(['♦A', '♣A'].sort());
  });
});

describe('军争篇关键花色点数(精确对应)', () => {
  it('古锭刀 = ♠A', () => {
    expect(locations('古锭刀')).toEqual([{ suit: '♠', rank: 'A' }]);
  });

  it('朱雀羽扇 = ♦A', () => {
    expect(locations('朱雀羽扇')).toEqual([{ suit: '♦', rank: 'A' }]);
  });

  it('白银狮子 = ♣A', () => {
    expect(locations('白银狮子')).toEqual([{ suit: '♣', rank: 'A' }]);
  });

  it('藤甲 = ♣2 + ♠2 共2张', () => {
    const locs = locations('藤甲').map((l) => `${l.suit}${l.rank}`);
    expect(locs.sort()).toEqual(['♣2', '♠2'].sort());
  });

  it('骅骝 = ♦K', () => {
    expect(locations('骅骝')).toEqual([{ suit: '♦', rank: 'K' }]);
  });

  it('火杀分布:♥4/♥7/♥10/♦4/♦5', () => {
    const fireKillLocs = FULL_DECK.filter(
      (c) => c.name === '杀' && c.damageType === '火焰',
    ).map((c) => `${c.suit}${c.rank}`);
    expect(fireKillLocs.sort()).toEqual(['♦4', '♦5', '♥10', '♥4', '♥7'].sort());
  });

  it('雷杀分布:♣5-8 + ♠4-8', () => {
    const thunderKillLocs = FULL_DECK.filter(
      (c) => c.name === '杀' && c.damageType === '雷电',
    ).map((c) => `${c.suit}${c.rank}`);
    expect(thunderKillLocs.sort()).toEqual([
      '♠4', '♠5', '♠6', '♠7', '♠8',
      '♣5', '♣6', '♣7', '♣8',
    ].sort());
  });

  it('酒分布:♣3/♣9/♠3/♠9/♦9', () => {
    const wineLocs = locations('酒').map((l) => `${l.suit}${l.rank}`);
    expect(wineLocs.sort()).toEqual(['♦9', '♣3', '♣9', '♠3', '♠9'].sort());
  });
});

describe('标准包 + 军争篇 EX 牌(每花色1张,共4张)', () => {
  // EX 牌:♥Q 闪电 / ♠2 寒冰剑 / ♦Q 无懈可击 / ♣2 仁王盾
  const STANDARD_ONLY = FULL_DECK.slice(0, 108);
  function stdLocations(name: string): Array<{ suit: Suit; rank: string }> {
    return STANDARD_ONLY.filter((c) => c.name === name).map((c) => ({ suit: c.suit, rank: c.rank }));
  }
  it('闪电在标准包有2张(♠A + ♥Q-EX)', () => {
    const locs = stdLocations('闪电').map((l) => `${l.suit}${l.rank}`);
    expect(locs.sort()).toEqual(['♥Q', '♠A'].sort());
  });

  it('寒冰刀(♠2 EX)1张', () => {
    expect(stdLocations('寒冰剑')).toEqual([{ suit: '♠', rank: '2' }]);
  });

  it('仁王盾(♣2 EX)1张', () => {
    expect(stdLocations('仁王盾')).toEqual([{ suit: '♣', rank: '2' }]);
  });
});
