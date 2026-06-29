// tests/integration/draw-reshuffle.test.ts
// 摸牌重洗补充集成测试 — 牌堆空但弃牌堆非空时,合并弃牌堆重洗后继续摸。
//
// 覆盖:
//   1. 牌堆不足:deck=[1张] discardPile=[2张],摸2 → 触发重洗,弃牌堆清空,手牌+2
//   2. 牌堆为空:deck=[] discardPile=[3张],摸2 → 弃牌堆补足,手牌+2
//   3. 牌堆+弃牌堆都不足:total<count → validate 拒绝
//   4. 牌堆充足:不触发重洗
//   5. 重洗确定性:相同 rngSeed + 相同 zones → 相同摸牌结果
//   6. 重洗后 rngSeed 被推进(后续随机事件可重放)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: { index: number; name: string; hand?: string[] }) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('摸牌:牌堆不足时重洗弃牌堆补充', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 牌堆不足触发重洗 ─────────────────────
  it('牌堆不足(deck=1 < count=2)且弃牌堆非空 → 合并重洗,摸2,弃牌堆清空', async () => {
    const d1 = makeCard('d1', '杀');
    const p1 = makeCard('p1', '闪');
    const p2 = makeCard('p2', '桃');
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
      cardMap: { d1, p1, p2 },
      zones: { deck: ['d1'], discardPile: ['p1', 'p2'], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
      rngSeed: 42,
    });
    await harness.setup(state);

    const handBefore = state.players[0].hand.length;
    await applyAtom(state, { type: '摸牌', player: 0, count: 2 });

    expect(state.players[0].hand.length).toBe(handBefore + 2);
    // 摸入的 2 张来自 deck+discardPile 的并集
    const drawn = state.players[0].hand.slice(-2);
    expect(['d1', 'p1', 'p2']).toEqual(expect.arrayContaining(drawn));
    // 弃牌堆重洗后被清空(全部并入新牌堆或被摸走)
    expect(state.zones.discardPile).toEqual([]);
    // 牌堆 = 合并总数 - 已摸 (1+2-2=1)
    expect(state.zones.deck.length).toBe(1);
    // 被摸走的 2 张不应出现在新牌堆或弃牌堆中
    const remaining = [...state.zones.deck, ...state.zones.discardPile];
    for (const id of drawn) {
      expect(remaining).not.toContain(id);
    }
    // 牌总数守恒:手牌增量 + (deck+discard+processing) 增量 = 0
    const totalNow =
      state.zones.deck.length +
      state.zones.discardPile.length +
      state.zones.processing.length +
      state.players.reduce((s, p) => s + p.hand.length, 0);
    expect(totalNow).toBe(3); // d1+p1+p2 共 3 张
  });

  // ─── 2. 牌堆完全为空 ─────────────────────
  it('牌堆为空,弃牌堆=3张,摸2 → 弃牌堆补足,手牌+2,弃牌堆清空', async () => {
    const p1 = makeCard('p1', '杀');
    const p2 = makeCard('p2', '闪');
    const p3 = makeCard('p3', '桃');
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
      cardMap: { p1, p2, p3 },
      zones: { deck: [], discardPile: ['p1', 'p2', 'p3'], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
      rngSeed: 100,
    });
    await harness.setup(state);
    // setup 会自动填充空牌堆(测试便利),这里重置为我们要的场景
    state.cardMap = { p1, p2, p3 };
    state.zones.deck = [];
    state.zones.discardPile = ['p1', 'p2', 'p3'];

    await applyAtom(state, { type: '摸牌', player: 0, count: 2 });

    expect(state.players[0].hand.length).toBe(2);
    expect(state.zones.discardPile).toEqual([]);
    expect(state.zones.deck.length).toBe(1); // 3-2=1
  });

  // ─── 3. 牌堆+弃牌堆都不足 ─────────────────────
  it('牌堆+弃牌堆总数 < count → validate 拒绝,不摸牌', async () => {
    const d1 = makeCard('d1', '杀');
    const p1 = makeCard('p1', '闪');
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
      cardMap: { d1, p1 },
      zones: { deck: ['d1'], discardPile: ['p1'], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
      rngSeed: 1,
    });
    await harness.setup(state);

    const _handBefore = state.players[0].hand.length;
    // total=2 < count=5 → validate 抛出异常
    await expect(applyAtom(state, { type: '摸牌', player: 0, count: 5 })).rejects.toThrow(
      'no cards available',
    );
  });

  // ─── 4. 牌堆充足不触发重洗 ─────────────────────
  it('牌堆充足(deck>=count)→ 不重洗,弃牌堆不变', async () => {
    const d1 = makeCard('d1', '杀');
    const d2 = makeCard('d2', '闪');
    const d3 = makeCard('d3', '桃');
    const p1 = makeCard('p1', '杀');
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
      cardMap: { d1, d2, d3, p1 },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: ['p1'], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
      rngSeed: 7,
    });
    await harness.setup(state);

    const seedBefore = state.rngSeed;
    await applyAtom(state, { type: '摸牌', player: 0, count: 2 });

    // 不重洗 → rngSeed 不变
    expect(state.rngSeed).toBe(seedBefore);
    // 弃牌堆不动
    expect(state.zones.discardPile).toEqual(['p1']);
    expect(state.zones.deck).toEqual(['d1']); // 摸走末尾 d3,d2
  });

  // ─── 5. 重洗确定性 ─────────────────────
  it('相同 rngSeed + 相同 zones → 相同摸牌结果(可重放)', async () => {
    async function run(seed: number): Promise<string[]> {
      const mk = (id: string, n: string) => makeCard(id, n);
      const s: GameState = createGameState({
        players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
        cardMap: {
          a: mk('a', '杀'),
          b: mk('b', '闪'),
          c: mk('c', '桃'),
          d: mk('d', '杀'),
          e: mk('e', '闪'),
        },
        // deck 非空('a')→ harness.setup 不会自动填牌
        zones: { deck: ['a'], discardPile: ['b', 'c', 'd', 'e'], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
        rngSeed: seed,
      });
      await harness.setup(s);
      await applyAtom(s, { type: '摸牌', player: 0, count: 3 });
      return s.players[0].hand.slice(-3);
    }

    const r1 = await run(999);
    const r2 = await run(999);
    expect(r1).toEqual(r2);
    // 不同种子结果应有差异(概率上,5选3 的排列空间足够大)
    const r3 = await run(88888);
    expect(r3).not.toEqual(r1);
  });

  // ─── 6. 重洗后 rngSeed 被推进 ─────────────────────
  it('重洗后 rngSeed 被推进(与原值不同)', async () => {
    const p1 = makeCard('p1', '杀');
    const p2 = makeCard('p2', '闪');
    const p3 = makeCard('p3', '桃');
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
      cardMap: { p1, p2, p3 },
      zones: { deck: [], discardPile: ['p1', 'p2', 'p3'], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
      rngSeed: 555,
    });
    await harness.setup(state);
    // setup 会自动填充空牌堆,重置为我们要的场景
    state.cardMap = { p1, p2, p3 };
    state.zones.deck = [];
    state.zones.discardPile = ['p1', 'p2', 'p3'];

    const seedBefore = state.rngSeed;
    await applyAtom(state, { type: '摸牌', player: 0, count: 2 });

    expect(state.rngSeed).not.toBe(seedBefore);
  });
});

describe('重洗 / 洗牌 atom 单元', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('重洗:合并 deck+discardPile,弃牌堆清空,牌总数守恒', async () => {
    const d1 = makeCard('d1', '杀');
    const p1 = makeCard('p1', '闪');
    const p2 = makeCard('p2', '桃');
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
      cardMap: { d1, p1, p2 },
      zones: { deck: ['d1'], discardPile: ['p1', 'p2'], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
      rngSeed: 321,
    });
    await harness.setup(state);

    await applyAtom(state, { type: '重洗' });

    expect(state.zones.deck.length).toBe(3); // 1+2
    expect(state.zones.discardPile).toEqual([]);
    // 三张牌都应在新牌堆里
    expect(state.zones.deck).toEqual(expect.arrayContaining(['d1', 'p1', 'p2']));
  });

  it('重洗:弃牌堆为空 → validate 拒绝', async () => {
    const d1 = makeCard('d1', '杀');
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
      cardMap: { d1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
      rngSeed: 1,
    });
    await harness.setup(state);

    await expect(applyAtom(state, { type: '重洗' })).rejects.toThrow('discardPile is empty');
  });

  it('洗牌:deck 牌序被打乱(确定性)', async () => {
    const cards = Array.from({ length: 10 }, (_, i) => makeCard(`c${i}`, '杀'));
    const cardMap: Record<string, Card> = {};
    for (const c of cards) cardMap[c.id] = c;
    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
      cardMap,
      zones: { deck: cards.map((c) => c.id), discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
      rngSeed: 42,
    });
    await harness.setup(state);
    const before = [...state.zones.deck];

    await applyAtom(state, { type: '洗牌' });

    // 牌数守恒
    expect(state.zones.deck.length).toBe(10);
    // 牌集合不变
    expect(state.zones.deck).toEqual(expect.arrayContaining(before));
    // 顺序大概率改变(10! 排列,相同概率极低)
    expect(state.zones.deck).not.toEqual(before);
  });
});
