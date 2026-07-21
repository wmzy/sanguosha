// tests/skill-tests/界恂恂.test.ts
// 界恂恂(界李典·主动技):摸牌阶段开始时,你可以观看牌堆顶的四张牌,
// 然后将其中两张牌置于牌堆顶,将剩余牌置于牌堆底。
//
// 官方来源:三国杀 OL 界限突破 hero/317。
//
// 验证:
//   1. respond validate:无 pending → 拒绝
//   2. respond validate:ARRANGE 下 top+bottom 非完整划分 → 拒绝
//   3. respond validate:ARRANGE 下含观察范围外的牌 → 拒绝
//   4. respond execute:CONFIRM choice=true → 写入 localVars
//   5. 端到端:摸牌阶段开始 → confirm → arrange → 牌堆重排
//   6. 端到端:confirm=false → 牌堆不变
//   7. 端到端:牌堆不足 4 张 → 观看可用张数
//   8. 端到端:牌堆为空 → 不触发
//   9. 端到端:其他玩家的摸牌阶段不触发本玩家
//
// 牌堆方向:deck[0]=牌堆底(最后摸),deck[len-1]=牌堆顶(最先摸)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
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
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 直接向 state 注入一个 fake 请求回应 pending(单元测试 validate 用)。 */
function injectPending(state: GameState, idx: number, requestType: string, prompt: unknown): void {
  state.pendingSlots.set(idx, {
    atom: {
      type: '请求回应',
      requestType,
      target: idx,
      prompt: prompt as never,
    },
    definition: undefined as never,
    startTime: 0,
    deadline: 100000,
    createdSeq: 0,
    isBlocking: true,
    resolve: () => {},
    isTimeout: false,
    isPaused: false,
    pause() {},
    _fireTimeoutNow: undefined,
  });
}

/** 触发 P1 的摸牌阶段:applyAtom(阶段开始, 0, 摸牌) → 界恂恂 after-hook。 */
async function triggerDrawPhase(harness: SkillTestHarness, player = 0): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '摸牌' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界恂恂', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界恂恂',
      actionType: 'respond',
      params: { choice: true },
    });
  });

  it('respond:ARRANGE 下 top+bottom 非完整划分 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 注入 ARRANGE pending,候选 4 张牌
    injectPending(state, 0, '恂恂/arrange', {
      type: 'distribute',
      mode: 'select',
      cardIds: ['a', 'b', 'c', 'd'],
    });

    // top+bottom 只覆盖 3 张 → 拒绝
    await P1.expectRejected({
      skillId: '界恂恂',
      actionType: 'respond',
      params: { top: ['a', 'b'], bottom: ['c'] },
    });
  });

  it('respond:ARRANGE 下含观察范围外的牌 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '恂恂/arrange', {
      type: 'distribute',
      mode: 'select',
      cardIds: ['a', 'b', 'c', 'd'],
    });

    // 'x' 不在观察范围内 → 拒绝
    await P1.expectRejected({
      skillId: '界恂恂',
      actionType: 'respond',
      params: { top: ['a', 'x'], bottom: ['b', 'c'] },
    });
  });

  // ─── respond execute ─────────────────────────

  it('respond:CONFIRM choice=true 写入 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '恂恂/confirm', { type: 'confirm', title: '是否发动?' });

    await P1.expectAccepted({
      skillId: '界恂恂',
      actionType: 'respond',
      params: { choice: true },
    });
    await harness.waitForStable();
    expect(state.localVars['恂恂/confirmed']).toBe(true);
  });

  // ─── 端到端 ─────────────────────────────────

  it('端到端:摸牌阶段 → confirm → arrange(top2置顶, bottom2置底) → 牌堆重排', async () => {
    // deck: [m1(底), o1, o2, o3, o4(顶)]
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const o4 = makeCard('o4', '杀', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { m1, o1, o2, o3, o4 },
      zones: { deck: ['m1', 'o1', 'o2', 'o3', 'o4'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerDrawPhase(harness);

    // 询问是否发动
    P1.expectPending('请求回应');
    const cslot = [...harness.state.pendingSlots.values()][0];
    const cAtom = cslot.atom as { requestType?: string; target?: number };
    expect(cAtom.requestType).toBe('恂恂/confirm');
    expect(cAtom.target).toBe(0);

    await P1.respond('界恂恂', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问排列
    P1.expectPending('请求回应');
    const aslot = [...harness.state.pendingSlots.values()][0];
    const aAtom = aslot.atom as {
      requestType?: string;
      prompt?: { cardIds?: string[] };
    };
    expect(aAtom.requestType).toBe('恂恂/arrange');
    expect(aAtom.prompt?.cardIds).toEqual(['o1', 'o2', 'o3', 'o4']); // top→bottom

    // 玩家选 o4, o1 置顶(o4 最先摸),o3, o2 置底
    await P1.respond('界恂恂', { top: ['o4', 'o1'], bottom: ['o3', 'o2'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 预期 newDeck = [...bottom=[o3,o2], ...middle=[m1], ...top.reverse()=[o1,o4]]
    //   = [o3, o2, m1, o1, o4]
    // deck 顶(末尾)= o4 → 摸牌时先抽到 o4
    expect(harness.state.zones.deck).toEqual(['o3', 'o2', 'm1', 'o1', 'o4']);
  });

  it('端到端:全置顶 → 牌堆顶 4 张按指定顺序', async () => {
    // deck: [m1, o1, o2, o3, o4(顶)] → 全置顶,顺序 [o2, o3, o4, o1]
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const o4 = makeCard('o4', '杀', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { m1, o1, o2, o3, o4 },
      zones: { deck: ['m1', 'o1', 'o2', 'o3', 'o4'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerDrawPhase(harness);
    await P1.respond('界恂恂', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    await P1.respond('界恂恂', { top: ['o2', 'o3', 'o4', 'o1'], bottom: [] });
    await harness.waitForStable();
    harness.processAllEvents();

    // newDeck = [...bottom=[], ...middle=[m1], ...top.reverse()=[o1,o4,o3,o2]]
    //   = [m1, o1, o4, o3, o2]
    expect(harness.state.zones.deck).toEqual(['m1', 'o1', 'o4', 'o3', 'o2']);
  });

  it('端到端:全置底 → 牌堆顶为原观察范围下方的牌', async () => {
    // deck: [m1, m2, o1, o2, o3, o4(顶)] → 全置底
    const m1 = makeCard('m1', '桃', '♥');
    const m2 = makeCard('m2', '桃', '♦');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const o4 = makeCard('o4', '杀', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { m1, m2, o1, o2, o3, o4 },
      zones: {
        deck: ['m1', 'm2', 'o1', 'o2', 'o3', 'o4'],
        processing: [],
        discardPile: [],
      },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerDrawPhase(harness);
    await P1.respond('界恂恂', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    await P1.respond('界恂恂', { top: [], bottom: ['o1', 'o2', 'o3', 'o4'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // newDeck = [...bottom=[o1,o2,o3,o4], ...middle=[m1,m2], ...top.reverse()=[]]
    //   = [o1, o2, o3, o4, m1, m2]; 顶=m2
    expect(harness.state.zones.deck).toEqual(['o1', 'o2', 'o3', 'o4', 'm1', 'm2']);
  });

  it('端到端:confirm=false → 牌堆不变', async () => {
    const m1 = makeCard('m1', '桃', '♥');
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const o4 = makeCard('o4', '杀', '♥');
    const originalDeck = ['m1', 'o1', 'o2', 'o3', 'o4'];
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { m1, o1, o2, o3, o4 },
      zones: { deck: [...originalDeck], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerDrawPhase(harness);
    P1.expectPending('请求回应');

    await P1.respond('界恂恂', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.zones.deck).toEqual(originalDeck);
  });

  it('端到端:牌堆不足 4 张(3 张)→ 观看可用张数', async () => {
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { o1, o2, o3 },
      zones: { deck: ['o1', 'o2', 'o3'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerDrawPhase(harness);
    await P1.respond('界恂恂', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问 arrange 时候选只有 3 张(不是 4)
    P1.expectPending('请求回应');
    const aslot = [...harness.state.pendingSlots.values()][0];
    const aAtom = aslot.atom as { prompt?: { cardIds?: string[] } };
    expect(aAtom.prompt?.cardIds).toEqual(['o1', 'o2', 'o3']);

    // 玩家选 o3 置顶,o1,o2 置底
    await P1.respond('界恂恂', { top: ['o3'], bottom: ['o1', 'o2'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // newDeck = [...bottom=[o1,o2], ...middle=[], ...top.reverse()=[o3]] = [o1, o2, o3]
    expect(harness.state.zones.deck).toEqual(['o1', 'o2', 'o3']);
  });

  it('端到端:牌堆为空 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      zones: { deck: [], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    // harness.setup 会自动填充空牌堆(20张);直接清空以测试空牌堆场景。
    // 直接 mutate state.zones.deck 不会走 atom 管线,关闭视图自动对比以避免假阳性。
    const restoreCompare = disableAutoCompare();
    const filledDeck = [...harness.state.zones.deck];
    harness.state.zones.deck = [];
    for (const id of filledDeck) delete harness.state.cardMap[id];

    try {
      await triggerDrawPhase(harness);
      // 牌堆空 → 不询问
      expect(harness.state.pendingSlots.size).toBe(0);
    } finally {
      restoreCompare();
    }
  });

  it('端到端:其他玩家的摸牌阶段不触发本玩家', async () => {
    const o1 = makeCard('o1', '杀', '♠');
    const o2 = makeCard('o2', '闪', '♣');
    const o3 = makeCard('o3', '酒', '♦');
    const o4 = makeCard('o4', '杀', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界恂恂'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { o1, o2, o3, o4 },
      zones: { deck: ['o1', 'o2', 'o3', 'o4'], processing: [], discardPile: [] },
      currentPlayerIndex: 1, // P2 的回合
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);

    // 触发 P2(idx=1) 的摸牌阶段
    await triggerDrawPhase(harness, 1);

    // P1 没有恂恂询问(skill.ownerId=0 ≠ atom.player=1)
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
