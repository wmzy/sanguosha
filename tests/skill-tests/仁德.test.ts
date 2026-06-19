// tests/skill-tests/仁德.test.ts
// 仁德(刘备)技能测试:
//   use:出牌阶段限一次,可以将任意手牌给其他角色(自己除外)。
//       给出 ≥2 张后回复 1 体力(每回合只回一次)。
//   params:targets = [{ target, cardIds }]
//
// 验证:
//   1. 正面:给 1 人 1 张牌 → 给到目标,自己出牌数 -1
//   2. 正面:给 1 人 2 张牌 → 自己回 1 血
//   3. 正面:给多人各 1 张 → 总计 2 张,也回 1 血
//   4. 正面:仁德限一次 → 第二次 use 拒绝
//   5. 负面:不给自己(target=自己)→ 拒绝
//   6. 负面:目标牌不在手牌 → 拒绝
//   7. 负面:重复 cardId → 拒绝
//   8. 负面:非自己回合 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
  return { id, name, suit, rank, type };
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
    character: '刘备',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['仁德'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  };
}

describe('仁德', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:use ─────────────────────────────

  it('use:给 1 人 1 张牌 → 目标拿到牌,自己手牌数 -1', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1'] }],
    });

    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[1].hand).toContain('c1');
    // 1 张牌 → 不回血
    expect(harness.state.players[0].health).toBe(3);
  });

  it('use:给 1 人 2 张牌 → 自己回 1 血(等同 4/4)', async () => {
    const c1 = makeCard('c1', '桃', '♥', 'A');
    const c2 = makeCard('c2', '桃', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1', 'c2'] }],
    });

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(harness.state.players[0].hand).toEqual([]);
  });

  it('use:给多人各 1 张牌,总数 ≥2 → 自己也回 1 血', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
        makePlayer({ index: 2, name: 'P3', hand: [] }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('仁德', 'use', {
      targets: [
        { target: 1, cardIds: ['c1'] },
        { target: 2, cardIds: ['c2'] },
      ],
    });

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].hand).toContain('c1');
    expect(harness.state.players[2].hand).toContain('c2');
  });

  // ─── distribute UI 提交路径(params.allocation)────────────

  it('use:通过 allocation 提交(distribute UI 路径)→ 等同 targets 分配格式', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '桃', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // distribute allocate UI 提交的格式:allocation=[{target,cardIds}]
    await P1.triggerAction('仁德', 'use', {
      allocation: [{ target: 1, cardIds: ['c1', 'c2'] }],
    });

    // 2 张 → 回 1 血
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
  });

  // ─── 限一次 ─────────────────────────────

  it('限一次:第二次发动 → 拒绝(usedThisTurn 标记)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次:成功
    await P1.triggerAction('仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1'] }],
    });
    expect(harness.state.players[1].hand).toContain('c1');

    // 第二次:拒绝(限一次)
    await P1.expectRejected({ skillId: '仁德', actionType: 'use', params: {
      targets: [{ target: 1, cardIds: ['c2'] }],
    } });
  });

  // ─── 负面 ─────────────────────────────

  it('负面:目标是自己 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 仁德不能给自己(target=0)
    await P1.expectRejected({ skillId: '仁德', actionType: 'use', params: {
      targets: [{ target: 0, cardIds: ['c1'] }],
    } });
  });

  it('负面:目标牌不在手牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '仁德', actionType: 'use', params: {
      targets: [{ target: 1, cardIds: ['c1'] }],
    } });
  });

  it('负面:重复 cardId → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
        makePlayer({ index: 2, name: 'P3', hand: [] }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 同一张牌给两个人(重复)
    await P1.expectRejected({ skillId: '仁德', actionType: 'use', params: {
      targets: [
        { target: 1, cardIds: ['c1'] },
        { target: 2, cardIds: ['c1'] },
      ],
    } });
  });

  it('负面:非自己回合 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '仁德', actionType: 'use', params: {
      targets: [{ target: 1, cardIds: ['c1'] }],
    } });
  });

  it('负面:不出牌(targets=空) → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1: makeCard('c1', '杀', '♠', 'A') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '仁德', actionType: 'use', params: { targets: [] } });
  });
});
