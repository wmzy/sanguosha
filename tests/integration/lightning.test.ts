// tests/integration/lightning.test.ts
// 集成测试:闪电(延时锦囊)——装备→判定区→判定。
//
// 覆盖:
//   1. 装备(添加延时锦囊)→ P0 判定区收到 闪电
//   2. 判定 → 翻判定牌到处理区 → after hooks → 进弃牌堆
//   3. 判定区同时存在 闪电 + 乐不思蜀 → 各自按 name 独立移除
//   4. 闪电 + 乐不思蜀 同回合分别判定 → 闪电消耗不影响乐不思蜀
//   5. 重复添加同 trick name → 去重,不入第二条
//
// 模式:SkillTestHarness(setup + player),用 applyAtom 触发添加/移除延时锦囊 +
// 判定 atom(因为 闪电 skill 尚未实现,本测试只覆盖 plumbing + 判定原子)
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SkillTestHarness,
} from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, PendingTrick } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
  pendingTricks?: PendingTrick[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, rank, type };
}

describe('闪电:延时锦囊判定(端到端 plumbing)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:装备(添加延时锦囊 atom)→ 闪电进 P0 判定区
  // ─────────────────────────────────────────────────────────────
  it('用例1:添加延时锦囊 → P0 判定区收到 闪电', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: [] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
      ],
      cardMap: { [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 验证初始判定区为空
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);

    // 装备:模拟 P1 对 P0 使用 闪电 → 添加延时锦囊
    await applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 1, card: sd },
    });

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('闪电');
    expect(harness.state.players[0].pendingTricks[0].source).toBe(1);
    expect(harness.state.players[0].pendingTricks[0].card).toEqual(sd);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:判定 → 翻判定牌到处理区 → after hooks 收尾 → 进弃牌堆
  // ─────────────────────────────────────────────────────────────
  it('用例2:判定 atom 翻判定牌到处理区 → after hooks 收尾入弃牌堆', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const judgeCard: Card = makeCard('jd1', '杀', '♥', '7', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          pendingTricks: [{ name: '闪电', source: 1, card: sd }],
        }),
      ],
      cardMap: { [sd.id]: sd, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);

    // 触发 判定 atom
    await applyAtom(harness.state, { type: '判定', player: 0, judgeType: '闪电' });

    // 判定牌已被从 deck 翻到 processing,after hooks 收尾后入 discardPile
    expect(harness.state.zones.deck).not.toContain(judgeCard.id);
    expect(harness.state.zones.processing).not.toContain(judgeCard.id);
    expect(harness.state.zones.discardPile).toContain(judgeCard.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:判定区同时有 闪电 + 乐不思蜀 → 各自按 name 独立
  // ─────────────────────────────────────────────────────────────
  it('用例3:判定区同时有 闪电 + 乐不思蜀 → 各自按 name 独立(移除一个不影响另一个)', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♥', 'K');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          pendingTricks: [
            { name: '闪电', source: 1, card: sd },
            { name: '乐不思蜀', source: 1, card: lb },
          ],
        }),
      ],
      cardMap: { [sd.id]: sd, [lb.id]: lb },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(2);

    // 移除延时锦囊:仅移除 闪电
    await applyAtom(harness.state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '闪电',
    });

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('乐不思蜀');

    // 再移除 乐不思蜀 → 判定区清空
    await applyAtom(harness.state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '乐不思蜀',
    });
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:同一玩家同回合:闪电判定 + 乐不思蜀判定 互不影响
  // (因为是不同延时锦囊,各自独立)
  // ─────────────────────────────────────────────────────────────
  it('用例4:闪电判定 + 乐不思蜀判定 各自独立(消耗一张不影响另一张)', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♥', 'K');
    const jd1: Card = makeCard('jd1', '杀', '♠', '7', '基本牌');
    const jd2: Card = makeCard('jd2', '桃', '♥', 'A', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          pendingTricks: [
            { name: '闪电', source: 1, card: sd },
            { name: '乐不思蜀', source: 1, card: lb },
          ],
        }),
      ],
      cardMap: {
        [sd.id]: sd,
        [lb.id]: lb,
        [jd1.id]: jd1,
        [jd2.id]: jd2,
      },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [jd1.id, jd2.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);

    // 第一张判定牌:用于 闪电
    await applyAtom(harness.state, { type: '判定', player: 0, judgeType: '闪电' });
    expect(harness.state.zones.discardPile).toContain(jd1.id);
    expect(harness.state.zones.processing).not.toContain(jd1.id);

    // 第二张判定牌:用于 乐不思蜀
    await applyAtom(harness.state, { type: '判定', player: 0, judgeType: '乐不思蜀' });
    expect(harness.state.zones.discardPile).toContain(jd2.id);
    expect(harness.state.zones.processing).not.toContain(jd2.id);

    // 两张判定牌都进了弃牌堆,牌堆清空
    expect(harness.state.zones.deck).toHaveLength(0);
    expect(harness.state.zones.discardPile).toHaveLength(2);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5:重复添加同 trick name → 去重
  // ─────────────────────────────────────────────────────────────
  it('用例5:重复添加 闪电 → 去重,不进第二条(原 source 保持)', async () => {
    const sd1: Card = makeCard('sd1', '闪电', '♠', 'A');
    const sd2: Card = makeCard('sd2', '闪电', '♠', 'K');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          pendingTricks: [{ name: '闪电', source: 1, card: sd1 }],
        }),
      ],
      cardMap: { [sd1.id]: sd1, [sd2.id]: sd2 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);

    // 用 sd2 再添加一次(同 trick name)
    await applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 2, card: sd2 },
    });

    // 仍只有 1 条,原 sd1 / source=1 保持不变
    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].card.id).toBe(sd1.id);
    expect(harness.state.players[0].pendingTricks[0].source).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 6:判定区被 移除延时锦囊 → 重新装备 → 正常入判定区
  // ─────────────────────────────────────────────────────────────
  it('用例6:移除 闪电 → 重新装备 → 闪电再次进判定区', async () => {
    const sd1: Card = makeCard('sd1', '闪电', '♠', 'A');
    const sd2: Card = makeCard('sd2', '闪电', '♠', 'K');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          pendingTricks: [{ name: '闪电', source: 1, card: sd1 }],
        }),
      ],
      cardMap: { [sd1.id]: sd1, [sd2.id]: sd2 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);

    // 移除 闪电
    await applyAtom(harness.state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '闪电',
    });
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);

    // 重新装备 闪电(sd2)
    await applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 2, card: sd2 },
    });
    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].card.id).toBe(sd2.id);
    expect(harness.state.players[0].pendingTricks[0].source).toBe(2);
  });
});