// 界观星(界诸葛亮·蜀·主动技)测试:
//   准备阶段,你可以观看牌堆顶的五张牌(存活角色数小于4时改为三张),
//   然后将之以任意顺序置于牌堆顶或牌堆底。若皆置于牌堆底,
//   结束阶段你可以再次发动本技能。
//
// OL hero/442 官方。与标观星区别:
//   1. X 计算:标版 X=min(全场角色数, 5);界版 X=(存活角色数<4)?3:5
//   2. 全置底 → 结束阶段可再次发动一次。
//
// 验证:
//   1. 2 人(存活<4)→ X=3,观察 3 张(标版此处 X=2)
//   2. 4 人(存活>=4)→ X=5,观察 5 张
//   3. 6 人(存活>=4)→ X=5(上限)
//   4. 准备阶段全置底 → 结束阶段触发再次发动询问
//   5. 准备阶段非全置底 → 结束阶段不再触发
//   6. 全置底但玩家不发动(confirm=false)→ 牌堆不变,标志仍消费
//   7. 排列正确性:全置顶 → 顶牌按指定顺序
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
  alive?: boolean;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '诸葛亮',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界观星'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发准备阶段:applyAtom(阶段开始, 0, 准备) → 界观星 after-hook 创建 pending 并阻塞。 */
async function triggerPreparePhase(harness: SkillTestHarness): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
  await harness.waitForStable();
  harness.processAllEvents();
}

/** 触发结束阶段:applyAtom(阶段开始, 0, 回合结束)。 */
async function triggerEndPhase(harness: SkillTestHarness): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界观星', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('界差异(2 人,存活<4)→ X=3,观察 3 张(标版此处 X=2)', async () => {
    // 2 人:存活=2 < 4 → X=3。deck: [m1, o1, o2, o3(顶)] → 观察顶 3 张 [o1, o2, o3]
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界观星'] }),
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
      cardMap: { m1, o1, o2, o3 },
      zones: { deck: ['m1', 'o1', 'o2', 'o3'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    P1.expectPending('请求回应'); // 界观星/confirm
    await P1.respond('界观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应'); // 界观星/arrange

    // 验证 arrange 询问包含 3 张牌(observed.length===3,证明 X=3)
    const slot = harness.state.pendingSlots.get(0);
    const cardIds = (slot?.atom as unknown as { prompt?: { cardIds?: string[] } }).prompt?.cardIds;
    expect(cardIds).toEqual(['o1', 'o2', 'o3']);

    // o1 放顶,o3 第二,o2 放底:top=[o1, o3], bottom=[o2]
    await P1.respond('界观星', { top: ['o1', 'o3'], bottom: ['o2'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 预期: [...bottom=[o2], ...middle=[m1], ...[o1,o3].reverse()=[o3,o1]] = [o2, m1, o3, o1]
    expect(harness.state.zones.deck).toEqual(['o2', 'm1', 'o3', 'o1']);
  });

  it('4 人(存活>=4)→ X=5,观察 5 张', async () => {
    // 4 人:存活=4 >= 4 → X=5。deck: [m1, o1..o5(顶)] → 观察顶 5 张
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const o4 = makeCard('o4', '杀', '♥');
    const o5 = makeCard('o5', '闪', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界观星'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [], character: '曹操', health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P3', hand: [], skills: [], character: '孙权', health: 4, maxHealth: 4 }),
        makePlayer({ index: 3, name: 'P4', hand: [], skills: [], character: '刘备', health: 4, maxHealth: 4 }),
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
    await P1.respond('界观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    P1.expectPending('请求回应'); // arrange

    // 验证 X=5
    const slot = harness.state.pendingSlots.get(0);
    const cardIds = (slot?.atom as unknown as { prompt?: { cardIds?: string[] } }).prompt?.cardIds;
    expect(cardIds).toEqual(['o1', 'o2', 'o3', 'o4', 'o5']);

    // 全置底:top=[], bottom=[o1..o5]
    await P1.respond('界观星', { top: [], bottom: ['o1', 'o2', 'o3', 'o4', 'o5'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 预期:[...bottom=[o1..o5], ...middle=[m1], ...top.reverse()=[]] = [o1..o5, m1]
    // 顶 = m1
    expect(harness.state.zones.deck).toEqual(['o1', 'o2', 'o3', 'o4', 'o5', 'm1']);
  });

  it('6 人(存活>5)→ X=5(上限)', async () => {
    // 6 人:存活=6 → X=5(5 张上限)
    const deck = ['m1', 'o1', 'o2', 'o3', 'o4', 'o5'];
    const cardMap: Record<string, Card> = { m1: makeCard('m1', '桃', '♥') };
    for (const id of ['o1', 'o2', 'o3', 'o4', 'o5']) {
      cardMap[id] = makeCard(id, '杀', '♠');
    }
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界观星'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [], character: '曹操', health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P3', hand: [], skills: [], character: '孙权', health: 4, maxHealth: 4 }),
        makePlayer({ index: 3, name: 'P4', hand: [], skills: [], character: '刘备', health: 4, maxHealth: 4 }),
        makePlayer({ index: 4, name: 'P5', hand: [], skills: [], character: '张飞', health: 4, maxHealth: 4 }),
        makePlayer({ index: 5, name: 'P6', hand: [], skills: [], character: '关羽', health: 4, maxHealth: 4 }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('界观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 验证 X=5(上限)
    const slot = harness.state.pendingSlots.get(0);
    const cardIds = (slot?.atom as unknown as { prompt?: { cardIds?: string[] } }).prompt?.cardIds;
    expect(cardIds).toHaveLength(5);
    expect(cardIds).toEqual(['o1', 'o2', 'o3', 'o4', 'o5']);
  });

  it('界差异:准备阶段全置底 → 结束阶段触发再次发动询问', async () => {
    // 2 人:存活=2 < 4 → X=3。准备阶段全置底 → 设标志;结束阶段触发再次发动。
    const m1 = makeCard('m1', '桃', '♥');
    const m2 = makeCard('m2', '酒', '♦');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '杀', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界观星'] }),
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
      cardMap: { m1, m2, o1, o2, o3 },
      zones: { deck: ['m1', 'm2', 'o1', 'o2', 'o3'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 准备阶段:全置底
    await triggerPreparePhase(harness);
    await P1.respond('界观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    await P1.respond('界观星', { top: [], bottom: ['o1', 'o2', 'o3'] });
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.pendingSlots.size).toBe(0);

    // 标志已设
    expect(harness.state.localVars['界观星/全置底']).toBe(true);

    // 触发结束阶段 → 再次发动询问(confirm)
    await triggerEndPhase(harness);
    P1.expectPending('请求回应'); // 界观星/confirm(再次发动)

    // 标志已消费清除(无论玩家是否发动,机会都是一次)
    await P1.respond('界观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.localVars['界观星/全置底']).toBeUndefined();
  });

  it('界差异:准备阶段非全置底 → 结束阶段不再触发', async () => {
    // 2 人:X=3。准备阶段部分置顶(非全置底) → 不设标志;结束阶段不触发。
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界观星'] }),
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
      cardMap: { m1, o1, o2, o3 },
      zones: { deck: ['m1', 'o1', 'o2', 'o3'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 准备阶段:部分置顶(top 非空 → 非全置底)
    await triggerPreparePhase(harness);
    await P1.respond('界观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    await P1.respond('界观星', { top: ['o1'], bottom: ['o2', 'o3'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 标志未设
    expect(harness.state.localVars['界观星/全置底']).toBeUndefined();

    // 触发结束阶段 → 不创建询问(无 pending)
    await triggerEndPhase(harness);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  it('负面:不发动(confirm=false)→ 牌堆不变,无 arrange 询问', async () => {
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界观星'] }),
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
      cardMap: { m1, o1, o2, o3 },
      zones: { deck: ['m1', 'o1', 'o2', 'o3'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    P1.expectPending('请求回应');
    await P1.pass();
    await harness.waitForStable();
    harness.processAllEvents();

    // 牌堆保持原样,无 arrange
    expect(harness.state.zones.deck).toEqual(['m1', 'o1', 'o2', 'o3']);
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.localVars['界观星/全置底']).toBeUndefined();
  });

  it('正面:全置顶(指定顺序)→ 顶牌按指定顺序', async () => {
    // 2 人:X=3。全置顶:o3 顶,o2 中,o1 底 → top=[o3, o2, o1]
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界观星'] }),
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
      cardMap: { m1, o1, o2, o3 },
      zones: { deck: ['m1', 'o1', 'o2', 'o3'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('界观星', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    await P1.respond('界观星', { top: ['o3', 'o2', 'o1'], bottom: [] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 预期: [...[], ...[m1], ...[o3,o2,o1].reverse()=[o1,o2,o3]] = [m1, o1, o2, o3]
    // 顶 = o3(最先摸)
    expect(harness.state.zones.deck).toEqual(['m1', 'o1', 'o2', 'o3']);
    expect(harness.state.zones.deck[3]).toBe('o3');
  });
});
