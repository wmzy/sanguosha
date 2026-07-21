// 界绝策(界李儒·群·被动技)测试(界限突破版):
//   "结束阶段,你可以对一名手牌数小于等于你的其他角色造成一点伤害。"
//
// 用例:
//   1. happy path:P0 手牌 2,P1 手牌 1 → 发动 → P1 受 1 点伤害
//   2. 不发动 → 无效果
//   3. 目标手牌数等于自己 → 合法(等于也算)
//   4. 无合法目标(所有其他角色手牌都 > P0)→ 不触发
//   5. P0 手牌 0,P1 手牌 0 → 合法(等于也算)
//   6. 选一名手牌 > 自己的目标 → 拒绝
//   7. 选自己 → 拒绝
//
// 触发方式:applyAtom({ type: '阶段开始', player: 0, phase: '回合结束' })
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name = '杀',
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
): Card {
  return { id, name, suit, color: suitColor(suit), rank: 'A', type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界李儒',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: '群',
  };
}

async function triggerEndPhase(harness: SkillTestHarness, player: number): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '回合结束' });
  await harness.waitForStable();
}

describe('界绝策', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path:P0 手牌 2,P1 手牌 1 → 发动 → P1 受 1 点伤害 ───
  it('happy path:对一名手牌数≤自己的其他角色造成1点伤害', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界绝策'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['t1'],
          skills: [],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap: {
        c1: makeCard('c1'),
        c2: makeCard('c2', '闪', '♥'),
        t1: makeCard('t1'),
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应'); // 是否发动

    await P0.respond('界绝策', { choice: true });
    P0.expectPending('请求回应'); // 选目标

    await P0.respond('界绝策', { targets: [1] });
    await harness.waitForStable();

    // P1 受 1 点伤害
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 2. 不发动 → 无效果 ────────────────────────────────────
  it('选择不发动 → 无伤害', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界绝策'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1'),
        c2: makeCard('c2', '闪', '♥'),
        t1: makeCard('t1'),
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界绝策', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 3. 目标手牌数等于自己 → 合法 ────────────────────────
  it('目标手牌数等于自己 → 合法', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界绝策'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['t1'], // 同为 1 张
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1'),
        t1: makeCard('t1'),
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界绝策', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('界绝策', { targets: [1] });
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 4. 无合法目标(所有其他角色手牌都 > P0)→ 不触发 ────
  it('无合法目标(P1 手牌更多)→ 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'], // 1 张
          skills: ['界绝策'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['t1', 't2', 't3'], // 3 张 > 1
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1'),
        t1: makeCard('t1'),
        t2: makeCard('t2', '闪', '♥'),
        t3: makeCard('t3', '桃', '♦'),
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);

    await triggerEndPhase(harness, 0);
    // 无 pending(无合法目标,绝策不触发)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 5. P0 手牌 0,P1 手牌 0 → 合法(等于也算)──────────────
  it('P0=0 手牌,P1=0 手牌 → 合法', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界绝策'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: [],
          skills: [],
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界绝策', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('界绝策', { targets: [1] });
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 6. 选一名手牌 > 自己的目标 → 拒绝 ────────────────────
  it('选手牌数 > 自己的目标 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'], // 1 张
          skills: ['界绝策'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['t1', 't2'], // 2 张 > 1
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['q1'], // 1 张 ≤ 1
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1'),
        t1: makeCard('t1'),
        t2: makeCard('t2', '闪', '♥'),
        q1: makeCard('q1'),
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界绝策', { choice: true });
    P0.expectPending('请求回应');

    // P2(手牌=1)合法;但选 P1(手牌=2 > P0 的 1)应被拒绝
    await P0.expectRejected({
      skillId: '界绝策',
      actionType: 'respond',
      params: { targets: [1] },
    });
  });

  // ─── 7. 选自己 → 拒绝 ────────────────────────────────────
  it('选自己 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界绝策'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1'),
        c2: makeCard('c2', '闪', '♥'),
        t1: makeCard('t1'),
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界绝策', { choice: true });
    P0.expectPending('请求回应');

    await P0.expectRejected({
      skillId: '界绝策',
      actionType: 'respond',
      params: { targets: [0] },
    });
  });
});
