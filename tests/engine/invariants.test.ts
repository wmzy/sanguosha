// tests/engine/invariants.test.ts
// 验证「牌唯一归属」不变量断言(assertCardInvariants):
//   1. 直接调用:同一 cardId 出现在多个区 → 抛错;无重复 → 不抛错;孤儿牌(边界)不抛错。
//   2. applyAtom 集成:开关开启时,正常完成路径触发断言;默认关闭时不触发。
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms'; // 注册 atom 定义(设阶段 等)
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { assertCardInvariants } from '../../src/engine/invariants';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

/** 构造一张最小测试牌 */
function makeCard(id: string, name = '测试牌'): Card {
  return { id, name, suit: '♠', color: '黑', rank: '1', type: '基本牌' };
}

/** 构造一个最小玩家槽位 */
function makePlayer(index: number): PlayerState {
  return {
    index,
    name: `P${index}`,
    character: '测试',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [],
    equipment: {},
    pendingTricks: [],
    skills: [],
    vars: {},
    marks: [],
    tags: [],
  };
}

/** 构造最小 state:含两张牌注册在 cardMap,可选开启不变量开关 */
function makeState(opts?: { assertInvariants?: boolean }): GameState {
  return createGameState({
    players: [makePlayer(0)],
    cardMap: { c1: makeCard('c1', '牌一'), c2: makeCard('c2', '牌二') },
    assertInvariants: opts?.assertInvariants,
  });
}

describe('assertCardInvariants —— 直接调用', () => {
  it('无重复时不抛错', () => {
    const s = makeState();
    s.zones.deck.push('c1');
    s.zones.discardPile.push('c2');
    expect(() => assertCardInvariants(s)).not.toThrow();
  });

  it('同一 cardId 同时在牌堆与弃牌堆 → 抛错并列出位置', () => {
    const s = makeState();
    s.zones.deck.push('c1');
    s.zones.discardPile.push('c1'); // 重复
    expect(() => assertCardInvariants(s)).toThrowError(/牌唯一归属不变量/);
    expect(() => assertCardInvariants(s)).toThrowError(/c1/);
    expect(() => assertCardInvariants(s)).toThrowError(/牌堆/);
    expect(() => assertCardInvariants(s)).toThrowError(/弃牌堆/);
  });

  it('手牌与装备槽重复 → 抛错', () => {
    const s = makeState();
    s.players[0].hand.push('c1');
    s.players[0].equipment = { 武器: 'c1' }; // 同一张既在手牌又是武器
    expect(() => assertCardInvariants(s)).toThrowError(/c1/);
  });

  it('处理区与结算帧重复 → 抛错', () => {
    const s = makeState();
    s.zones.processing.push('c1');
    s.settlementStack.push({ skillId: '测试技能', from: -1, params: {}, cards: ['c1'], cancelled: false });
    expect(() => assertCardInvariants(s)).toThrowError(/c1/);
  });

  it('孤儿牌(cardMap 存在但不在任何区)不抛错 —— 允许影子卡/转化牌等边界', () => {
    const s = makeState();
    // c1 放进区,c2 留在 cardMap 但不在任何区(模拟影子卡/延时锦囊 pendingTricks)
    s.zones.deck.push('c1');
    expect(() => assertCardInvariants(s)).not.toThrow();
  });

  it('同一区内的重复也算重复(防 deck 自身重复)', () => {
    const s = makeState();
    s.zones.deck.push('c1', 'c1'); // 同一牌堆出现两次
    expect(() => assertCardInvariants(s)).toThrowError(/c1/);
  });
});

describe('assertCardInvariants —— applyAtom 集成(开关保护)', () => {
  it('开关开启 + 存在重复 → applyAtom 正常完成路径抛错', async () => {
    const s = makeState({ assertInvariants: true });
    s.zones.deck.push('c1');
    s.zones.discardPile.push('c1'); // 重复
    // 设阶段 是无 pending 的简单 atom,走非等待型正常完成路径
    await expect(applyAtom(s, { type: '设阶段', phase: '准备' })).rejects.toThrowError(
      /牌唯一归属不变量/,
    );
  });

  it('开关开启 + 无重复 → applyAtom 正常完成不抛错', async () => {
    const s = makeState({ assertInvariants: true });
    s.zones.deck.push('c1');
    s.zones.discardPile.push('c2');
    await expect(applyAtom(s, { type: '设阶段', phase: '准备' })).resolves.toBe(true);
  });

  it('默认关闭(未设 assertInvariants)+ 存在重复 → 不抛错,正常返回 true', async () => {
    const s = makeState(); // assertInvariants 未设置
    s.zones.deck.push('c1');
    s.zones.discardPile.push('c1'); // 重复但开关关闭
    await expect(applyAtom(s, { type: '设阶段', phase: '准备' })).resolves.toBe(true);
  });

  it('显式关闭(assertInvariants=false)+ 存在重复 → 不抛错', async () => {
    const s = makeState({ assertInvariants: false });
    s.zones.deck.push('c1');
    s.zones.discardPile.push('c1');
    await expect(applyAtom(s, { type: '设阶段', phase: '准备' })).resolves.toBe(true);
  });
});
