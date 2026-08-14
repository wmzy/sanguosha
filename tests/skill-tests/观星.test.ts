// tests/skill-tests/观星.test.ts
// 观星(诸葛亮·主动技)测试:准备阶段开始时,观看牌堆顶 X 张牌并重新排列。
//
// 验证:
//   1. 正面(2 人,X=2):交换顶两张顺序 + 实际摸牌验证(摸 1 张 = 指定的 top[0])
//   2. 正面:全部放牌堆底 → 原顶两张到最底,原未观察牌升到顶
//   3. 边界:6 人 → X 封顶 5(至多 5 张),未观察的第 6 张升到顶
//   4. 负面:非法排列(非完整划分)→ 牌堆保持原样
//   5. 负面:不发动(confirm=false) → 牌堆不变
//   6. 边界:3 人 → X=3,观察 3 张(混合 top/bottom)
//
// 牌堆方向:deck[0]=牌堆底(最后摸),deck[len-1]=牌堆顶(最先摸)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '诸葛亮',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['观星'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发准备阶段:applyAtom(阶段开始, 0, 准备) → 观星 after-hook 创建 pending 并阻塞。
 *  用 void fire-and-forget,再 waitForStable 等 pending 创建。 */
async function triggerPreparePhase(harness: SkillTestHarness): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('观星', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('正面(2人,X=2):交换顶两张顺序 → deck 顶顺序翻转,且摸牌验证 top[0] 先摸', async () => {
    // deck: [m1(底), o1, o2(顶)] → 观察顶 2 张 [o1, o2]
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['观星'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { m1, o1, o2 },
      zones: { deck: ['m1', 'o1', 'o2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    P1.expectPending('请求回应'); // 观星/confirm

    // 确认发动
    await P1.respond('观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应'); // 观星/arrange

    // 交换顺序:o1 放最顶(最先摸),o2 第二 → top=[o1, o2]
    await P1.respond('观星', { top: ['o1', 'o2'], bottom: [] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 预期新 deck: [...bottom=[], ...middle=[m1], ...top.reverse()=[o2,o1]] = [m1, o2, o1]
    // 顶(deck 末尾)= o1(最先摸),底(deck[0])= m1
    const deck = harness.state.zones.deck;
    expect(deck).toEqual(['m1', 'o2', 'o1']);
    expect(deck[deck.length - 1]).toBe('o1'); // o1 在顶

    // 实际摸 1 张 → 应是顶牌 o1(端到端验证 top[0] 最先摸)
    await applyAtom(harness.state, { type: '摸牌', player: 0, count: 1 });
    expect(harness.state.players[0].hand).toContain('o1');
  });

  it('正面:全部放牌堆底 → 原顶两张到最底,原未观察牌升到顶', async () => {
    // deck: [m1, m2, o1, o2(顶)] → 观察顶 2 张 [o1, o2]
    const m1 = makeCard('m1', '桃', '♥');
    const m2 = makeCard('m2', '酒', '♦');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['观星'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { m1, m2, o1, o2 },
      zones: { deck: ['m1', 'm2', 'o1', 'o2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应'); // arrange

    // 全部放底:top=[], bottom=[o1, o2]
    await P1.respond('观星', { top: [], bottom: ['o1', 'o2'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 预期: [...bottom=[o1,o2], ...middle=[m1,m2], ...top.reverse()=[]] = [o1, o2, m1, m2]
    // 顶 = m2(最先摸)
    const deck = harness.state.zones.deck;
    expect(deck).toEqual(['o1', 'o2', 'm1', 'm2']);
    expect(deck[deck.length - 1]).toBe('m2');
  });

  it('边界:6 人 → X 封顶 5(至多 5 张),未观察的第 6 张升到顶', async () => {
    // deck: [m1(底), o1, o2, o3, o4, o5(顶)] → 6 人, X=min(6,5)=5,观察顶 5 张 [o1..o5]
    // m1(第 6 张)不在观察范围 → 留在 middle;5 张全放底后 m1 升到顶(若 X=6 则 m1 会被观察、无法独自到顶)
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const o4 = makeCard('o4', '桃', '♥');
    const o5 = makeCard('o5', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['观星'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P3',
          hand: [],
          skills: [],
          character: '孙权',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 3,
          name: 'P4',
          hand: [],
          skills: [],
          character: '刘备',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 4,
          name: 'P5',
          hand: [],
          skills: [],
          character: '张飞',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 5,
          name: 'P6',
          hand: [],
          skills: [],
          character: '关羽',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { m1, o1, o2, o3, o4, o5 },
      zones: { deck: ['m1', 'o1', 'o2', 'o3', 'o4', 'o5'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应'); // arrange

    // 5 张全放底:top=[], bottom=[o1..o5]
    await P1.respond('观星', { top: [], bottom: ['o1', 'o2', 'o3', 'o4', 'o5'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 预期: [...bottom=5张, ...middle=[m1], ...top.reverse()=[]] = [o1,o2,o3,o4,o5,m1]
    // 顶 = m1(第 6 张,未被观察)→ 证明 X=5 而非 6
    const deck = harness.state.zones.deck;
    expect(deck).toEqual(['o1', 'o2', 'o3', 'o4', 'o5', 'm1']);
    expect(deck[deck.length - 1]).toBe('m1');
  });

  it('负面:非法排列(top/bottom 非完整划分)→ 牌堆保持原样', async () => {
    // deck: [m1, o1, o2(顶)] → 观察 [o1, o2]
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['观星'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { m1, o1, o2 },
      zones: { deck: ['m1', 'o1', 'o2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应'); // arrange

    // 非法划分:只给 o1、缺 o2 → 不构成 observed=[o1,o2] 的完整划分
    await P1.respond('观星', { top: ['o1'], bottom: [] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 实现对非法划分保持原序、不调整牌堆
    expect(harness.state.zones.deck).toEqual(['m1', 'o1', 'o2']);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('负面:不发动(confirm=false) → 牌堆不变', async () => {
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['观星'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { m1, o1, o2 },
      zones: { deck: ['m1', 'o1', 'o2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    P1.expectPending('请求回应');

    // 不发动:choice=false(等同 pass)
    await P1.pass();
    await harness.waitForStable();
    harness.processAllEvents();

    // 牌堆保持原样,无 arrange 询问
    expect(harness.state.zones.deck).toEqual(['m1', 'o1', 'o2']);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('边界:3 人 → X=3,观察 3 张', async () => {
    // deck: [m1, o1, o2, o3(顶)] → 3 人 X=min(3,5)=3,观察顶 3 张 [o1, o2, o3]
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['观星'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P3',
          hand: [],
          skills: [],
          character: '孙权',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { m1, o1, o2, o3 },
      zones: { deck: ['m1', 'o1', 'o2', 'o3'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应'); // arrange

    // o1 放顶(最先摸),o3 第二,o2 放底:top=[o1, o3], bottom=[o2]
    await P1.respond('观星', { top: ['o1', 'o3'], bottom: ['o2'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 预期: [...bottom=[o2], ...middle=[m1], ...[o1,o3].reverse()=[o3,o1]] = [o2, m1, o3, o1]
    // 顶 = o1
    expect(harness.state.zones.deck).toEqual(['o2', 'm1', 'o3', 'o1']);
    expect(harness.state.zones.deck[3]).toBe('o1');
  });
});
