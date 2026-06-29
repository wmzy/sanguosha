// tests/skill-tests/制衡.test.ts
// 制衡(孙权·技能)测试:
//   use:出牌阶段限一次,弃任意数量的手牌或装备,摸等量的牌。
//
// 验证:
//   1. 正面:弃 1 张手牌 → 摸 1 张,手牌数先 -1 再 +1
//   2. 正面:弃 N 张手牌 → 摸 N 张
//   3. 正面:装备也能制衡(武器/防具→手牌数不变但装备卸下)
//   4. 正面:defineAction use action 声明可用(availableActions())
//   5. 限一次:第二次发动 → 拒绝
//   6. 负面:非自己回合 → 拒绝
//   7. 负面:不存在的 cardId → 拒绝
//   8. 负面:cardIds=空数组 → 拒绝
//   9. 负面:不在手牌也不在装备区的牌 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { dispatch as engineDispatch } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeEquip(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物',
  rank = 'A',
  range?: number,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype, range };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '孙权',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['制衡'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('制衡', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:弃手牌 → 摸等量 ───────────────────────────

  it('use:弃 1 张手牌 → 摸 1 张(净手牌数不变)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const deck1 = makeCard('d1', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, d1: deck1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('制衡', 'use', { cardIds: ['c1'] });

    // P1 弃了 c1,摸了 d1
    expect(harness.state.players[0].hand).toEqual(['d1']);
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.deck).toEqual([]);
    // view 级断言
    P1.processEvents();
    P1.expectView((v) => {
      expect(v.players[0].handCount).toBe(1);
      expect(v.pending).toBeNull();
    });
  });

  it('use:弃 3 张手牌 → 摸 3 张(净手牌数 +2)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const c3 = makeCard('c3', '桃', '♦', '5');
    const d1 = makeCard('d1', '杀', '♠', '3');
    const d2 = makeCard('d2', '闪', '♥', '7');
    const d3 = makeCard('d3', '桃', '♦', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2', 'c3'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, c2, c3, d1, d2, d3 },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('制衡', 'use', { cardIds: ['c1', 'c2', 'c3'] });

    // 弃 3 摸 3:手牌从 [c1,c2,c3] → [d3,d2,d1](摸牌倒序入栈)
    expect(harness.state.players[0].hand).toHaveLength(3);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['d1', 'd2', 'd3']));
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c2');
    expect(harness.state.players[0].hand).not.toContain('c3');
    // 弃 3 张
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']));
  });

  // ─── 正面:装备也能制衡 ─────────────────────────────

  it('use:装备(武器/防具)也能制衡 → 卸下装备 + 摸等量', async () => {
    const weapon = makeEquip('w1', '诸葛连弩', '♣', '武器', 'A', 1);
    const armor = makeEquip('a1', '八卦阵', '♣', '防具', 'A');
    const d1 = makeCard('d1', '杀', '♠', '3');
    const d2 = makeCard('d2', '闪', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], equipment: { 武器: 'w1', 防具: 'a1' } }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { w1: weapon, a1: armor, d1, d2 },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('制衡', 'use', { cardIds: ['w1', 'a1'] });

    // 装备栏清空(装备卸下→弃牌堆)
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].equipment['防具']).toBeUndefined();
    // 弃牌堆有 2 张装备
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['w1', 'a1']));
    // 摸 2 张
    expect(harness.state.players[0].hand).toHaveLength(2);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['d1', 'd2']));
  });

  it('use:手牌 + 装备混合制衡', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const weapon = makeEquip('w1', '诸葛连弩', '♣', '武器', 'A', 1);
    const d1 = makeCard('d1', '闪', '♥', '7');
    const d2 = makeCard('d2', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], equipment: { 武器: 'w1' } }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, w1: weapon, d1, d2 },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('制衡', 'use', { cardIds: ['c1', 'w1'] });

    // 装备栏清空(装备卸下→弃牌堆)
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    // 弃牌堆有 c1 + w1
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'w1']));
    // 摸 2 张(deck 必须有 ≥2)
    expect(harness.state.players[0].hand).toHaveLength(2);
  });

  // ─── defineAction 声明验证 ─────────────────────────

  it('availableActions:列出 use action,prompt 是 distribute select(可多选)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const actions = P1.availableActions();
    const zhiheng = actions.find((a) => a.skillId === '制衡' && a.actionType === 'use');
    expect(zhiheng).toBeDefined();
    expect(zhiheng!.label).toBe('制衡');
    expect(zhiheng!.prompt.type).toBe('distribute');
    if (zhiheng!.prompt.type === 'distribute') {
      expect(zhiheng!.prompt.mode).toBe('select');
      expect(zhiheng!.prompt.source).toBe('handAndEquip');
      expect(zhiheng!.prompt.minTotal).toBe(1);
      expect(zhiheng!.prompt.maxTotal).toBe(99);
    }
  });

  // ─── 限一次 ─────────────────────────────

  it('限一次:第二次发动 → 拒绝(usedThisTurn 标记)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const d1 = makeCard('d1', '桃', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, c2, d1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次:成功
    await P1.triggerAction('制衡', 'use', { cardIds: ['c1'] });
    // P1 起始 [c1, c2],制衡弃 c1 摸 d1 → 手牌变 [c2, d1]
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c2', 'd1']));
    expect(harness.state.players[0].hand).not.toContain('c1');

    // 第二次:拒绝(限一次)
    await P1.expectRejected({
      skillId: '制衡',
      actionType: 'use',
      params: { cardIds: ['c2'] },
    });
  });

  it('时序防回归:连发两次 dispatch(不等第一次稳定)→ 第二次被拒', async () => {
    // 模拟真实 session 行为:void dispatch 连发,不 await 第一次完成。
    // 修复前 usedThisTurn 在 execute 末尾才设,第二次 validate 在第一次 execute 设标记前跑 → 通过 → bug。
    // 修复后 usedThisTurn 在 execute 开头同步设置,第二次 validate 必然拒绝。
    // JS 单线程:async 函数的同步部分在调用时立即执行到第一个 await。
    // 第一次 engineDispatch 同步部分(validate1 → seq+=1 → 启动 execute1 → execute1 同步跑到首个 await)
    // 跑完后才进入第二次 engineDispatch 的同步部分(validate2)。
    // 因此 validate2 看到的 usedThisTurn 状态由 execute1 同步部分决定。
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const d1 = makeCard('d1', '桃', '♦', '5');
    const d2 = makeCard('d2', '桃', '♦', '6');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, c2, d1, d2 },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const seq0 = state.seq;
    // 连发:第一次 dispatch(同步部分含 execute1 同步到首个 await),紧接着第二次。
    void engineDispatch(state, {
      skillId: '制衡',
      actionType: 'use',
      ownerId: 0,
      baseSeq: seq0,
      params: { cardIds: ['c1'] },
    });
    const seqAfterFirst = state.seq; // execute1 同步部分跑完后 seq 已递增
    void engineDispatch(state, {
      skillId: '制衡',
      actionType: 'use',
      ownerId: 0,
      baseSeq: seqAfterFirst,
      params: { cardIds: ['c2'] },
    });
    const seqAfterSecond = state.seq;
    await harness.waitForStable();

    // 第二次 dispatch 被 validate 拒绝 → 不递增 seq(seqAfterSecond === seqAfterFirst)。
    // 第一次 dispatch 成功 → seq 大于 seq0(具体增量取决于内部 atom 数量,不硬编码)。
    expect(seqAfterSecond).toBe(seqAfterFirst);
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c2');
    expect(harness.state.players[0].hand).toContain('c2');
  });

  // ─── 负面 ─────────────────────────────

  it('负面:cardIds=空数组 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '制衡',
      actionType: 'use',
      params: { cardIds: [] },
    });
  });

  it('负面:不在手牌也不在装备区的牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }), // c1 不在 P1 手牌
        makePlayer({ index: 1, name: 'P2', hand: ['c1'] }), // c1 在 P2 手牌
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1 想制衡 P2 的牌 → 拒绝
    await P1.expectRejected({
      skillId: '制衡',
      actionType: 'use',
      params: { cardIds: ['c1'] },
    });
  });

  it('负面:不存在的 cardId → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '制衡',
      actionType: 'use',
      params: { cardIds: ['nonexistent'] },
    });
  });

  // ─── turnUsage view 同步(前端禁用制衡重复发动的数据源)─────────────

  it('turnUsage:发动后 usedThisTurn 同步到 view(event 流 + buildView)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♥', '2');
    const deck1 = makeCard('d1', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], skills: ['制衡'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, c2, d1: deck1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 初始:未发动制衡
    P1.processEvents();
    expect(P1.processedView.players[0].turnUsage?.['制衡/usedThisTurn']).toBeUndefined();

    await P1.triggerAction('制衡', 'use', { cardIds: ['c1'] });

    // 发动后:usedThisTurn=true(event 流与 buildView 双路径一致)
    P1.processEvents();
    expect(P1.processedView.players[0].turnUsage?.['制衡/usedThisTurn']).toBe(true);
    expect(P1.view.players[0].turnUsage?.['制衡/usedThisTurn']).toBe(true);
  });
});
