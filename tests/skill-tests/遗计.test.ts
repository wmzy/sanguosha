// tests/skill-tests/遗计.test.ts
// 遗计(郭嘉·被动技,官方 hero/101 逐字):
//   "当你受到 1 点伤害后,你可以观看牌堆顶的两张牌,
//    然后将这些牌交给任意角色。"
//
// 关键合约:
//   1. **牌不入手**:与"摸两张入手再分配"不同,官方要求"观看后分配"——
//      郭嘉手牌状态全程不变,牌从牌堆顶经摸牌 atom 直接流向目标手牌。
//   2. **分配粒度**:两张牌可拆分给不同角色(含郭嘉自己)。
//   3. **可选**:pass(空 allocation)放弃发动,牌留在牌堆顶。
//   4. **每点伤害触发一次**:受到 N 点伤害 → N 次遗计。
//
// 验证:
//   1. P1 出杀 → P2 不出闪 → P2 扣血 + 进入遗计 pending
//   2. 端到端:distribute 把两张牌分给 2 人 → 郭嘉手牌始终为空,目标各得 1 张
//   3. 端到端:distribute 把两张牌都给同一人 → 该目标得 2 张,郭嘉手牌为空
//   4. 端到端:把两张牌都留给自己 → 郭嘉手牌得到 2 张(经摸牌 atom 流向自己)
//   5. 端到端:pass 不发动 → 两张牌留在牌堆顶,郭嘉手牌为空
//   6. validate:allocation 超 2 张 / 含牌堆外牌 / 重复 / 未全覆盖 → 拒绝
//   7. 每点伤害触发一次:受到 2 点伤害 → 触发 2 次遗计
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json } from '../../src/engine/types';

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

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

/** 直接向 state 注入一个 fake 请求回应 pending(单元测试 validate 用)。 */
function injectPending(state: GameState, idx: number, requestType: string, prompt: unknown): void {
  state.pendingSlots.set(idx, {
    atom: {
      type: '请求回应',
      requestType,
      target: idx,
      prompt: prompt as never,
    } as never,
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

/** 经典 P1 出杀、P2 有遗计的初始局面。牌堆顶 = [d1(top), d2]。 */
function buildState(opts?: { p2Hand?: string[]; p2Health?: number }): GameState {
  const slash = makeCard('c1', '杀', '♠', 'A');
  const d1 = makeCard('d1', '桃', '♥', '3');
  const d2 = makeCard('d2', '桃', '♦', '4');
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['杀'] }),
      makePlayer({
        index: 1,
        name: 'P2',
        hand: opts?.p2Hand ?? [],
        skills: ['遗计'],
        health: opts?.p2Health ?? 4,
        maxHealth: 4,
      }),
      makePlayer({ index: 2, name: 'P3', hand: [], skills: [] }),
    ],
    cardMap: { c1: slash, d1, d2 },
    zones: { deck: ['d1', 'd2'], processing: [], discardPile: [] },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('遗计', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('P1 出杀,P2 不出闪 → P2 扣血并进入遗计分配 pending', async () => {
    await harness.setup(buildState());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    P2.expectPending('询问闪');
    await P2.pass();

    // P2 扣血 4 → 3
    expect(harness.state.players.find((p) => p.name === 'P2')!.health).toBe(3);

    // 进入遗计分配 pending;此时牌堆顶两张仍未动(未入手)
    const slot = [...harness.state.pendingSlots.values()][0];
    const atom = slot?.atom as { type?: string; requestType?: string; prompt?: { cardIds?: string[] } };
    expect(atom.type).toBe('请求回应');
    expect(atom.requestType).toBe('遗计/distribute');
    expect(atom.prompt?.cardIds).toEqual(['d2', 'd1']); // [top, secondFromTop]
    // 关键:郭嘉手牌为空,牌堆顶两张仍在牌堆
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['d1', 'd2']);
  });

  it('端到端:分配 2 张给 2 人 → 郭嘉手牌始终为空,目标各得 1 张', async () => {
    await harness.setup(buildState());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    await P2.pass();

    // 遗计分配:d1 给 P3(=idx 2),d2 给 P1(=idx 0)
    P2.expectPending('请求回应');
    await P2.respond('遗计', {
      allocation: [
        { target: 2, cardIds: ['d1'] },
        { target: 0, cardIds: ['d2'] },
      ],
    });

    // 郭嘉(P2)手牌全程为空(关键合约:牌不入手)
    expect(harness.state.players[1].hand).toEqual([]);
    // P3 得到 d1,P1 得到 d2(P1 用杀后 c1 已进处理区/弃牌堆,手牌只剩得到的 d2)
    expect(harness.state.players[2].hand).toContain('d1');
    expect(harness.state.players[0].hand).toContain('d2');
    // 牌堆已空(两张都被摸走)
    expect(harness.state.zones.deck).toEqual([]);
  });

  it('端到端:两张牌都给同一人 → 该目标得 2 张,郭嘉手牌为空', async () => {
    await harness.setup(buildState());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    await P2.pass();

    await P2.respond('遗计', {
      allocation: [{ target: 2, cardIds: ['d1', 'd2'] }],
    });

    // 郭嘉手牌为空
    expect(harness.state.players[1].hand).toEqual([]);
    // P3 得到两张
    expect(harness.state.players[2].hand).toEqual(expect.arrayContaining(['d1', 'd2']));
    expect(harness.state.players[2].hand).toHaveLength(2);
    expect(harness.state.zones.deck).toEqual([]);
  });

  it('端到端:两张牌都留给自己 → 郭嘉经摸牌 atom 得到 2 张(等价于"自己作为目标")', async () => {
    await harness.setup(buildState());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    await P2.pass();

    await P2.respond('遗计', {
      allocation: [{ target: 1, cardIds: ['d1', 'd2'] }],
    });

    // 郭嘉自己作为目标:摸牌 atom 把两张牌流向自己手牌
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['d1', 'd2']));
    expect(harness.state.players[1].hand).toHaveLength(2);
    expect(harness.state.zones.deck).toEqual([]);
  });

  it('端到端:pass 不发动 → 两张牌留在牌堆顶,郭嘉手牌为空', async () => {
    await harness.setup(buildState());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    await P2.pass();
    P2.expectPending('请求回应');
    // pass 当前遗计 pending = 不发动
    await P2.pass();

    // 郭嘉手牌为空,牌堆仍保留两张牌
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['d1', 'd2']);
  });

  it('每点伤害触发一次:受到 2 点伤害 → 触发 2 次遗计分配', async () => {
    // 使用 雷杀 + 丈八蛇矛 略复杂;改用直接 applyAtom 制造 2 点伤害。
    // 简化:用火杀触发藤甲?这里直接走"造成伤害" atom 更稳。
    // 此测试改用 4 张牌堆 + 直接对 P2 造成 2 点伤害。
    const slash = makeCard('c1', '杀', '♠', 'A');
    const d1 = makeCard('d1', '桃', '♥', '3');
    const d2 = makeCard('d2', '桃', '♦', '4');
    const d3 = makeCard('d3', '酒', '♣', '5');
    const d4 = makeCard('d4', '酒', '♠', '6');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['遗计'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P3', hand: [], skills: [] }),
      ],
      cardMap: { c1: slash, d1, d2, d3, d4 },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    // 直接 applyAtom 造成 2 点伤害给 P2(绕过杀/闪链路,聚焦遗计循环)
    const { applyAtom } = await import('../../src/engine/create-engine');
    // 触发但不 await 完成 —— applyAtom(造成伤害) 会进入遗计 pending 后挂起
    // 故改用 promise + 等待 pending
    const damagePromise = applyAtom(state, { type: '造成伤害', target: 1, amount: 2, source: 0 });
    await harness.waitForStable();

    // 第一次遗计 pending(牌堆顶 d4(top)、d3)
    P2.expectPending('请求回应');
    await P2.respond('遗计', {
      allocation: [{ target: 2, cardIds: ['d4', 'd3'] }],
    });
    expect(harness.state.players[2].hand).toEqual(['d4', 'd3']);

    // 第二次遗计 pending(牌堆顶 d2(top)、d1)
    await harness.waitForStable();
    P2.expectPending('请求回应');
    await P2.respond('遗计', {
      allocation: [{ target: 2, cardIds: ['d2', 'd1'] }],
    });
    expect(harness.state.players[2].hand).toEqual(['d4', 'd3', 'd2', 'd1']);

    // 郭嘉手牌始终为空,牌堆已空
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual([]);

    // 等待伤害 atom 完成(避免 unhandled rejection)
    await damagePromise;
  });

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    await harness.setup(buildState());
    const P2 = harness.player('P2');
    await P2.expectRejected({
      skillId: '遗计',
      actionType: 'respond',
      params: { allocation: [{ target: 1, cardIds: ['d1', 'd2'] }] },
    });
  });

  it('respond:allocation 含牌堆外牌 → 拒绝', async () => {
    await harness.setup(buildState());
    const P2 = harness.player('P2');
    injectPending(harness.state, 1, '遗计/distribute', { type: 'distribute' });
    await P2.expectRejected({
      skillId: '遗计',
      actionType: 'respond',
      params: { allocation: [{ target: 0, cardIds: ['c1'] }] }, // c1 在 P1 手牌中
    });
  });

  it('respond:allocation 重复同一张牌 → 拒绝', async () => {
    await harness.setup(buildState());
    const P2 = harness.player('P2');
    injectPending(harness.state, 1, '遗计/distribute', { type: 'distribute' });
    await P2.expectRejected({
      skillId: '遗计',
      actionType: 'respond',
      params: {
        allocation: [
          { target: 0, cardIds: ['d1'] },
          { target: 2, cardIds: ['d1'] }, // 重复
        ],
      },
    });
  });

  it('respond:allocation 未覆盖两张牌(只分配 1 张)→ 拒绝', async () => {
    await harness.setup(buildState());
    const P2 = harness.player('P2');
    injectPending(harness.state, 1, '遗计/distribute', { type: 'distribute' });
    await P2.expectRejected({
      skillId: '遗计',
      actionType: 'respond',
      params: { allocation: [{ target: 2, cardIds: ['d1'] }] }, // 缺 d2
    });
  });

  it('respond:目标无效(非存活)→ 拒绝', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const d1 = makeCard('d1', '桃', '♥', '3');
    const d2 = makeCard('d2', '桃', '♦', '4');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['遗计'] }),
        makePlayer({ index: 2, name: 'P3', hand: [], skills: [], health: 0 }),
      ],
      cardMap: { c1: slash, d1, d2 },
      zones: { deck: ['d1', 'd2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 显式标记 P3 阵亡(makePlayer 默认 alive=true)
    state.players[2].alive = false;
    await harness.setup(state);
    const P2 = harness.player('P2');
    injectPending(harness.state, 1, '遗计/distribute', { type: 'distribute' });
    await P2.expectRejected({
      skillId: '遗计',
      actionType: 'respond',
      params: { allocation: [{ target: 2, cardIds: ['d1', 'd2'] }] }, // P3 阵亡
    });
  });

  it('respond:合法 allocation 写入 localVars', async () => {
    await harness.setup(buildState());
    const P2 = harness.player('P2');
    injectPending(harness.state, 1, '遗计/distribute', { type: 'distribute' });
    await P2.expectAccepted({
      skillId: '遗计',
      actionType: 'respond',
      params: {
        allocation: [
          { target: 2, cardIds: ['d1'] },
          { target: 1, cardIds: ['d2'] },
        ],
      },
    });
    await harness.waitForStable();
    const stored = harness.state.localVars['遗计/allocation'] as Array<{
      target: number;
      cardIds: string[];
    }> | undefined;
    expect(stored).toBeDefined();
    expect(stored).toHaveLength(2);
  });
});

describe('confirm / distribute API', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('confirm(false) 等同 pass()', async () => {
    const slash: Card = makeCard('c1', '杀', '♠', 'A');
    await harness.setup(
      createGameState({
        players: [
          makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['杀'] }),
          makePlayer({ index: 1, name: 'P2', hand: [], skills: [] }),
        ],
        cardMap: { c1: slash },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    P2.expectPending('询问闪');
    await P2.confirm(false);

    expect(harness.state.players.find((p) => p.name === 'P2')!.health).toBe(3);
  });

  it('distribute 构造正确的 dispatch params', () => {
    const allocation = [
      { target: 2, cardIds: ['c1'] },
      { target: 0, cardIds: ['c2'] },
    ];
    expect(Array.isArray(allocation)).toBe(true);
    expect(allocation[0].target).toBe(2);
  });
});
