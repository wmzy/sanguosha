// tests/skill-tests/观星.test.ts
// 观星(诸葛亮·主动技)测试:准备阶段开始时,观看牌堆顶 X 张牌并重新排列。
//
// 验证:
//   1. 正面(2 人,X=2):交换顶两张顺序 → 牌堆顶顺序翻转
//   2. 正面:全部放牌堆底 → 原顶两张到最底,原未观察牌升到顶
//   3. 正面:全部放牌堆顶(指定顺序)→ 顶两张按指定顺序
//   4. 正面:实际摸牌验证顶牌(观星后摸 1 张 = 指定的 top[0])
//   5. 负面:不发动(confirm=false) → 牌堆不变
//   6. 边界:3 人 → X=3,观察 3 张
//
// 牌堆方向:deck[0]=牌堆底(最后摸),deck[len-1]=牌堆顶(最先摸)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
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

  it('正面(2人,X=2):交换顶两张顺序 → deck 顶顺序翻转', async () => {
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

  it('正面:全部放牌堆顶(指定顺序)→ 顶两张按指定顺序', async () => {
    // deck: [m1, o1, o2(顶)] → 观察顶 2 张 [o1, o2]
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
    P1.expectPending('请求回应');

    // 全部放顶,o2 在最顶(最先摸):top=[o2, o1]
    await P1.respond('观星', { top: ['o2', 'o1'], bottom: [] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 预期: [...[], ...[m1], ...[o2,o1].reverse()=[o1,o2]] = [m1, o1, o2]
    // 顶 = o2(最先摸)
    expect(harness.state.zones.deck).toEqual(['m1', 'o1', 'o2']);
    expect(harness.state.zones.deck[2]).toBe('o2');
  });

  it('正面:观星后实际摸牌,验证顶牌为指定的 top[0]', async () => {
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
    // top=[o1, o2] → o1 在顶(最先摸)
    await P1.respond('观星', { top: ['o1', 'o2'], bottom: [] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 实际摸 1 张 → 应是 o1
    await applyAtom(harness.state, { type: '摸牌', player: 0, count: 1 });
    expect(harness.state.players[0].hand).toContain('o1');
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
