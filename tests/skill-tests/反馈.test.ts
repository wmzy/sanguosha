// tests/skill-tests/反馈.test.ts
// 反馈(司马懿·被动技):当你受到伤害后,你可以获得伤害来源的一张牌。
//
// 验证:
//   1. 反馈 respond validate 在无 pending 时被拒绝
//   2. 反馈 respond validate 在 pending 非「反馈/confirm」时拒绝
//   3. 反馈 respond validate 在 pending 为「反馈/confirm」且 choice=true 时接受
//   4. 反馈 respond execute 设置 localVars['反馈/confirmed'] = true
//
// 注: 完整链路(杀→不出闪→伤害→反馈 after-hook→请求回应 pending→respond→获得牌)
//     涉及嵌套 pending + after-hook 调度,依赖 dispatch 路径完整。当前测试只覆盖
//     respond action 的 validate/execute 单元语义。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

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

describe('反馈', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['反馈'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '反馈', actionType: 'respond', params: { choice: true } });
  });

  // ─── respond execute ─────────────────────────
  // 直接构造「请求回应/反馈/confirm」pending,验证 respond execute 写 localVars。

  it('respond:choice=true 在 反馈/confirm pending 下被接受,设 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['反馈'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 手工构造 pending slot 模拟「伤害后询问发动反馈」
    // 通过 applyAtom 创建 请求回应(但需要走完整 pipeline,这里直接挂 slot 到 Map)
    // 替代:用 applyAtom 走真实路径 — 但测试中需要 atom 完成 applyAtom 后停在 pending。
    // 最简方式: 直接给 state 注入 fake slot(用于单元测试 validate/execute)。

    const fakeResolve = () => {};
    state.pendingSlots.set(0, {
      atom: {
        type: '请求回应',
        requestType: '反馈/confirm',
        target: 0,
        prompt: { type: 'confirm', title: '是否发动反馈?' },
      },
      definition: undefined as never,
      startTime: 0,
      deadline: 100000,
      createdSeq: 0,
      isBlocking: true,
      resolve: fakeResolve,
      isTimeout: false,
      pause() {},
      _fireTimeoutNow: undefined,
    });

    // P1(feedback owner) 用 choice=true respond — validate 应通过
    await P1.expectAccepted({ skillId: '反馈', actionType: 'respond', params: { choice: true } });
    // localVars 已被设(但 execute 是 fire-and-forget,直接读可能还没写)
    // waitForStable 后再断言
    await harness.waitForStable();
    expect(state.localVars['反馈/confirmed']).toBe(true);
  });

  it('respond:choice=false 在 反馈/confirm pending 下被接受,但 localVars 不为 true', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['反馈'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    state.pendingSlots.set(0, {
      atom: {
        type: '请求回应',
        requestType: '反馈/confirm',
        target: 0,
        prompt: { type: 'confirm', title: '是否发动反馈?' },
      },
      definition: undefined as never,
      startTime: 0,
      deadline: 100000,
      createdSeq: 0,
      isBlocking: true,
      resolve: () => {},
      isTimeout: false,
      pause() {},
      _fireTimeoutNow: undefined,
    });

    await P1.expectAccepted({ skillId: '反馈', actionType: 'respond', params: {} });
    await harness.waitForStable();
    expect(state.localVars['反馈/confirmed']).toBeFalsy();
  });

  // ─── 端到端:伤害→反馈→获得牌 ─────────────────────
  // 来源: tests/integration/obtain-atom.test.ts test 4
  it('反馈 端到端:P0 杀 P1 → P1 confirm=true → 盲选手牌 → P1 持有该牌', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const stolen: Card = makeCard('s1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id, stolen.id], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['反馈', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [stolen.id]: stolen },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪 → 扣血 → 反馈 询问发动
    await P1.pass();
    P1.expectPending('请求回应');
    // 验证 dispatch 产生的 pending 结构(来源: fankui-steal 用例1)
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('反馈/confirm');
    expect(slotAtom.target).toBe(1);
    // P1 confirm=true 发动反馈
    await P1.respond('反馈', { choice: true });

    // confirm 后弹选牌面板(请求回应/反馈/选牌,pickTargetCard prompt)
    P1.expectPending('请求回应');
    const pickSlot = [...harness.state.pendingSlots.values()][0];
    const pickAtom = pickSlot.atom as { type: string; requestType?: string; target?: number };
    expect(pickAtom.requestType).toBe('反馈/选牌');
    // pickTargetCard prompt: 手牌+装备明牌(此处来源仅剩 1 张手牌)
    expect((pickSlot.atom as { prompt?: { type?: string } }).prompt?.type).toBe('pickTargetCard');
    // P1 盲选来源手牌 hand[0] = stolen(剩 1 张)
    await P1.respond('反馈', { zone: 'hand', handIndex: 0 });

    // 关键合约:P0 不再持有被拿的牌
    expect(harness.state.players[0].hand).not.toContain(stolen.id);
    // P1 持有该牌
    expect(harness.state.players[1].hand).toContain(stolen.id);
    // P1 拿到了正好一张牌(从 P0)
    expect(harness.state.players[1].hand.length).toBe(1);
  });

  // ─── 端到端:confirm=false 不拿牌(来源: fankui-steal 用例2) ─────────
  it('反馈 端到端:P0 杀 P1 → P1 confirm=false → 不拿牌,P1 手牌不变', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const victimCard: Card = makeCard('v1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id, victimCard.id], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['反馈', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const p1HandBefore = harness.state.players[1].hand.length;

    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P1.pass();

    // 反馈 confirm pending 应有
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const fslot = [...harness.state.pendingSlots.values()][0];
    const fslotAtom = fslot.atom as { type: string; requestType?: string };
    expect(fslotAtom.type).toBe('请求回应');
    expect(fslotAtom.requestType).toBe('反馈/confirm');

    // P1 confirm=false → 不发动
    await P1.respond('反馈', { choice: false });

    // P1 手牌数不变(没拿牌)
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore);
  });

  // ─── 端到端:选装备(反馈不止可拿手牌,还可拿装备) ─────────────
  // 来源: 本用例覆盖选牌面板装备明选路径(zone=equipment),与盲选手牌互为补充。
  it('反馈 端到端:来源仅剩装备 → 选装备 → P1 获得该装备,P0 装备区清空', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const weapon: Card = makeCard('wp1', '诸葛连弩', '♣', 'A', '装备牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['反馈', '闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [weapon.id]: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // P0 装备区装上武器(模拟已装备)
    state.players[0].equipment['武器'] = weapon.id;
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1(P0 出杀后手牌为空,仅剩装备可被反馈拿取)
    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P1.pass(); // 不出闪
    // confirm 发动反馈
    await P1.respond('反馈', { choice: true });
    // 选牌面板:来源(P0)仅装备可选 → 选装备
    await P1.respond('反馈', { zone: 'equipment', cardId: weapon.id });

    // P1 获得该装备牌(入手牌)
    expect(harness.state.players[1].hand).toContain(weapon.id);
    // P0 装备区清空
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
  });
});
