// tests/skill-tests/界遗计.test.ts
// 界遗计(界郭嘉·被动技):当你受到 1 点伤害后,你可以摸两张牌,
// 然后你可以交给至多两名其他角色共计至多两张手牌。
//
// 官方来源:三国杀 OL 界限突破 hero/316。
//
// 界版变化(相对旧错误实现):
//   - 摸两张牌(非一张)。
//   - 可交至多两张任意手牌(非一张、非仅摸到的牌)给至多两名其他角色(非一名)。
//   - 交牌可选(confirm);无其他存活角色或自己无手牌时跳过。
//
// 验证:
//   1. respond validate:无 pending → 拒绝
//   2. respond validate:GIVE_RT pending 下 allocation 超 2 张牌 → 拒绝
//   3. respond validate:GIVE_RT pending 下 allocation 超 2 名目标 → 拒绝
//   4. respond validate:GIVE_RT pending 下 allocation 含自己 → 拒绝
//   5. respond execute:GIVE_RT pending 下 allocation 写入 localVars['遗计/allocation']
//   6. 端到端:P0 杀 P1 → P1 confirm → 摸2张 + 交2张给2人 → P1 手牌空,P2/P3 各得1
//   7. 端到端:P0 杀 P1 → P1 confirm → 摸2张 + 只交1张给1人 → P1 留1张,P2 得1张
//   8. 端到端:P0 杀 P1 → P1 confirm=false → 摸2张,不交牌
//   9. 端到端:无其他存活角色 → 摸2张后跳过交牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

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

/** 直接向 state 注入一个 fake 请求回应 pending(单元测试 validate/execute 用)。 */
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

describe('界遗计', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── respond validate ─────────────────────────

  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['界遗计'] }),
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
      skillId: '界遗计',
      actionType: 'respond',
      params: { choice: true },
    });
  });

  it('respond:GIVE_RT allocation 超 2 张牌 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['a', 'b', 'c'], skills: ['界遗计'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['杀'] }),
        makePlayer({ index: 2, name: 'P3', hand: [], skills: ['杀'] }),
      ],
      cardMap: {
        a: makeCard('a', '杀'),
        b: makeCard('b', '杀'),
        c: makeCard('c', '杀'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '遗计/giveCard', { type: 'distribute', mode: 'allocate' });

    // 3 张牌(超 2)→ 拒绝
    await P1.expectRejected({
      skillId: '界遗计',
      actionType: 'respond',
      params: {
        allocation: [
          { target: 1, cardIds: ['a', 'b'] },
          { target: 2, cardIds: ['c'] },
        ],
      },
    });
  });

  it('respond:GIVE_RT allocation 超 2 名目标 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['a', 'b'], skills: ['界遗计'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['杀'] }),
        makePlayer({ index: 2, name: 'P3', hand: [], skills: ['杀'] }),
        makePlayer({ index: 3, name: 'P4', hand: [], skills: ['杀'] }),
      ],
      cardMap: {
        a: makeCard('a', '杀'),
        b: makeCard('b', '杀'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '遗计/giveCard', { type: 'distribute', mode: 'allocate' });

    // 3 个目标(超 2)→ 拒绝
    await P1.expectRejected({
      skillId: '界遗计',
      actionType: 'respond',
      params: {
        allocation: [
          { target: 1, cardIds: [] },
          { target: 2, cardIds: [] },
          { target: 3, cardIds: [] },
        ].map((e) => ({ ...e, cardIds: e.target === 1 ? ['a'] : e.target === 2 ? ['b'] : [] })),
      },
    });
  });

  it('respond:GIVE_RT allocation 含自己目标 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['a', 'b'], skills: ['界遗计'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['杀'] }),
      ],
      cardMap: {
        a: makeCard('a', '杀'),
        b: makeCard('b', '杀'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '遗计/giveCard', { type: 'distribute', mode: 'allocate' });

    // 目标 0 是自己 → 拒绝
    await P1.expectRejected({
      skillId: '界遗计',
      actionType: 'respond',
      params: {
        allocation: [{ target: 0, cardIds: ['a'] }],
      },
    });
  });

  // ─── respond execute ─────────────────────────

  it('respond:GIVE_RT 合法 allocation 写入 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['a', 'b'], skills: ['界遗计'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['杀'] }),
        makePlayer({ index: 2, name: 'P3', hand: [], skills: ['杀'] }),
      ],
      cardMap: {
        a: makeCard('a', '杀'),
        b: makeCard('b', '杀'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '遗计/giveCard', { type: 'distribute', mode: 'allocate' });

    // 合法 allocation:2 张牌分给 2 人
    await P1.expectAccepted({
      skillId: '界遗计',
      actionType: 'respond',
      params: {
        allocation: [
          { target: 1, cardIds: ['a'] },
          { target: 2, cardIds: ['b'] },
        ],
      },
    });
    await harness.waitForStable();
    const stored = state.localVars['遗计/allocation'] as Array<{
      target: number;
      cardIds: string[];
    }> | undefined;
    expect(stored).toBeDefined();
    expect(stored).toHaveLength(2);
    expect(stored![0]).toEqual({ target: 1, cardIds: ['a'] });
    expect(stored![1]).toEqual({ target: 2, cardIds: ['b'] });
  });

  it('respond:CONFIRM_RT choice=true 写入 localVars', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界遗计'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    injectPending(state, 0, '遗计/giveConfirm', { type: 'confirm', title: '是否交牌?' });

    await P1.expectAccepted({
      skillId: '界遗计',
      actionType: 'respond',
      params: { choice: true },
    });
    await harness.waitForStable();
    expect(state.localVars['遗计/confirmed']).toBe(true);
  });

  // ─── 端到端 ─────────────────────────────────

  it('端到端:P0 杀 P1 → P1 confirm → 摸2张 + 交2张给2人 → P1 空,P2/P3 各得1张', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const drawn1: Card = makeCard('g1', '桃', '♥', '3');
    const drawn2: Card = makeCard('g2', '桃', '♦', '4');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界遗计', '闪'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['杀'] }),
        makePlayer({ index: 3, name: 'P3', hand: [], skills: ['杀'] }),
      ],
      cardMap: {
        k1: slash,
        g1: drawn1,
        g2: drawn2,
      },
      zones: { deck: ['g1', 'g2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 不出闪
    await P1.pass();

    // 询问是否交牌
    P1.expectPending('请求回应');
    const cslot = [...harness.state.pendingSlots.values()][0];
    const cAtom = cslot.atom as { type: string; requestType?: string; target?: number };
    expect(cAtom.requestType).toBe('遗计/giveConfirm');
    expect(cAtom.target).toBe(1);

    // P1 摸了 2 张牌(界遗计关键合约:摸 2 张,非 1 张)
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['g1', 'g2']));
    expect(harness.state.players[1].hand).toHaveLength(2);

    // P1 确认交牌
    await P1.respond('界遗计', { choice: true });

    // 询问交牌(distribute)
    P1.expectPending('请求回应');
    const gslot = [...harness.state.pendingSlots.values()][0];
    const gAtom = gslot.atom as { type: string; requestType?: string; prompt?: { type?: string } };
    expect(gAtom.requestType).toBe('遗计/giveCard');
    expect(gAtom.prompt?.type).toBe('distribute');

    // P1 把 2 张牌分给 P2 和 P3(至多 2 张给至多 2 人)
    // 经 respond + allocation 提交(界遗计 pending 注册的 actionType 是 'respond')
    await P1.respond('界遗计', {
      allocation: [
        { target: 2, cardIds: ['g1'] },
        { target: 3, cardIds: ['g2'] },
      ],
    });

    // 验证分配结果
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.players[2].hand).toContain('g1');
    expect(harness.state.players[3].hand).toContain('g2');
  });

  it('端到端:只交 1 张给 1 人 → P1 保留 1 张,P2 得 1 张', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const drawn1: Card = makeCard('g1', '桃', '♥', '3');
    const drawn2: Card = makeCard('g2', '桃', '♦', '4');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界遗计', '闪'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['杀'] }),
      ],
      cardMap: {
        k1: slash,
        g1: drawn1,
        g2: drawn2,
      },
      zones: { deck: ['g1', 'g2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    await P1.respond('界遗计', { choice: true });

    // 只交 1 张给 P2
    await P1.respond('界遗计', {
      allocation: [{ target: 2, cardIds: ['g1'] }],
    });

    // P1 保留 g2(官方允许至多 2 张,不强制全交)
    expect(harness.state.players[1].hand).toContain('g2');
    expect(harness.state.players[1].hand).toHaveLength(1);
    expect(harness.state.players[2].hand).toContain('g1');
  });

  it('端到端:confirm=false → 摸2张后不交牌', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const drawn1: Card = makeCard('g1', '桃', '♥', '3');
    const drawn2: Card = makeCard('g2', '桃', '♦', '4');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界遗计', '闪'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['杀'] }),
      ],
      cardMap: {
        k1: slash,
        g1: drawn1,
        g2: drawn2,
      },
      zones: { deck: ['g1', 'g2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // P1 选择不交牌
    await P1.respond('界遗计', { choice: false });

    // P1 仍保留摸到的 2 张牌
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['g1', 'g2']));
    expect(harness.state.players[1].hand).toHaveLength(2);
    // P2 没拿到牌
    expect(harness.state.players[2].hand).toEqual([]);
  });

  it('端到端:GIVE_RT prompt 为 distribute allocate(至多 2 张给至多 2 人, 不含自己)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const drawn1: Card = makeCard('g1', '桃', '♥', '3');
    const drawn2: Card = makeCard('g2', '桃', '♦', '4');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['界遗计', '闪'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['杀'] }),
      ],
      cardMap: { k1: slash, g1: drawn1, g2: drawn2 },
      zones: { deck: ['g1', 'g2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    await P1.respond('界遗计', { choice: true });

    // 骨重提示应包含关键约束:最多 2 张 / 2 人 / 不能给自己 / 手牌
    const gslot = [...harness.state.pendingSlots.values()][0];
    const gAtom = gslot.atom as {
      type: string;
      requestType?: string;
      prompt?: {
        type?: string;
        mode?: string;
        source?: string;
        minPerTarget?: number;
        maxPerTarget?: number;
        minTotal?: number;
        maxTotal?: number;
        allowSelf?: boolean;
      };
    };
    expect(gAtom.requestType).toBe('遗计/giveCard');
    expect(gAtom.prompt?.type).toBe('distribute');
    expect(gAtom.prompt?.mode).toBe('allocate');
    expect(gAtom.prompt?.source).toBe('hand');
    expect(gAtom.prompt?.minPerTarget).toBe(1);
    expect(gAtom.prompt?.maxPerTarget).toBe(2);
    expect(gAtom.prompt?.minTotal).toBe(1);
    expect(gAtom.prompt?.maxTotal).toBe(2);
    expect(gAtom.prompt?.allowSelf).toBe(false);

    // 交 1 张给 P2 后结束
    await P1.respond('界遗计', { allocation: [{ target: 2, cardIds: ['g1'] }] });
  });
});
