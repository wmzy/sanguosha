// tests/skill-tests/装备通用.test.ts
// 装备通用(系统级)技能测试:
//   use:出牌阶段对装备牌使用,装入对应栏位(根据 card.subtype)。
//   旧装备卸下进弃牌堆,新装备占位。若装备牌有同名技能,动态挂载技能实例。
//
// 验证:
//   1. 正面:装武器(诸葛连弩)→ equipment.武器 = id
//   2. 正面:装防具(八卦阵)→ equipment.防具 = id
//   3. 正面:装备替换(先装剑,再装弩)→ 旧剑进弃牌堆,新弩占位
//   4. 负面:非自己回合 → 拒绝
//   5. 负面:不在手牌的装备牌 → 拒绝
//   6. 负面:不是装备牌(基本牌当装备) → 拒绝(无 subtype)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { findActionEntry } from '../../src/engine/skill';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeEquip(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物', rank = 'A', range?: number): Card {
  return { id, name, suit, rank, type: '装备牌', subtype, range };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['装备通用'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  };
}

describe('装备通用', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:use 装备 ─────────────────────────────

  it('use:装武器(诸葛连弩)→ equipment.武器 = id,手牌减 1', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'c1');

    expect(harness.state.players[0].equipment['武器']).toBe('c1');
    expect(harness.state.players[0].hand).not.toContain('c1');
  });

  it('use:装防具(八卦阵) → equipment.防具 = id', async () => {
    const bagua = makeEquip('b1', '八卦阵', '♣', '防具', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['b1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { b1: bagua },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'b1');

    expect(harness.state.players[0].equipment['防具']).toBe('b1');
  });

  // ─── 装备替换 ─────────────────────────────

  it('装备替换:先装剑,再装弩 → 旧剑进弃牌堆,弩占位', async () => {
    const sword = makeEquip('w1', '青釭剑', '♠', '武器', 'A', 2);
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['w1', 'c1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { w1: sword, c1: crossbow },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 先装青釭剑
    await P1.useCard('装备通用', 'w1');
    expect(harness.state.players[0].equipment['武器']).toBe('w1');

    // 再装诸葛连弩(同栏位替换)
    await P1.useCard('装备通用', 'c1');
    expect(harness.state.players[0].equipment['武器']).toBe('c1');
    // 旧剑进弃牌堆
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[0].hand).toEqual([]);
  });

  it('装备替换不同栏位互不影响(防具替换防具,武器保留)', async () => {
    const bagua = makeEquip('b1', '八卦阵', '♣', '防具', 'A');
    const renwang = makeEquip('r1', '仁王盾', '♠', '防具', '5');
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['b1', 'c1', 'r1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { b1: bagua, c1: crossbow, r1: renwang },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'c1'); // 武器
    await P1.useCard('装备通用', 'b1'); // 防具
    await P1.useCard('装备通用', 'r1'); // 替换防具

    expect(harness.state.players[0].equipment['武器']).toBe('c1');
    expect(harness.state.players[0].equipment['防具']).toBe('r1');
    // 旧防具进弃牌堆
    expect(harness.state.zones.discardPile).toContain('b1');
  });

  // ─── 负面:use ─────────────────────────────

  it('use:非自己回合 → 拒绝', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '装备通用', actionType: 'use', params: { cardId: 'c1' } });
  });

  it('use:不在手牌的装备 → 拒绝', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '装备通用', actionType: 'use', params: { cardId: 'c1' } });
  });

  it('use:不是装备牌(基本牌当装备) → 拒绝(无 subtype)', async () => {
    // 装备 validate:hasSubtype = !!card?.subtype
    // 一张杀(type=基本牌)没有 subtype → 拒绝
    const slash: Card = { id: 's1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '装备通用', actionType: 'use', params: { cardId: 's1' } });
  });

  // ─── Bug1:装备替换时旧装备技能实例被卸载 ─────────────────
  it('Bug1:装备替换时旧装备技能(诸葛连弩)被卸载,旧 hook 实例消失', async () => {
    const crossbow = makeEquip('c1', '诸葛连弩', '♣', '武器', 'A', 1);
    const sword = makeEquip('w1', '青釭剑', '♠', '武器', 'A', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'w1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1: crossbow, w1: sword },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 装诸葛连弩 → 诸葛连弩 skill 注册(玩家0 上有 阶段开始 hook)
    await P1.useCard('装备通用', 'c1');
    expect(harness.state.players[0].equipment['武器']).toBe('c1');
    expect(harness.state.players[0].skills).toContain('诸葛连弩');

    // 替换为青釭剑 → 诸葛连弩 应从 skills 列表移除并卸载
    await P1.useCard('装备通用', 'w1');
    expect(harness.state.players[0].equipment['武器']).toBe('w1');
    expect(harness.state.players[0].skills).not.toContain('诸葛连弩');
    expect(harness.state.players[0].skills).toContain('青釭剑');
    // 旧装备卡已进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
  });
});
