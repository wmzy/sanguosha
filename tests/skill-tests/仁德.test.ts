// tests/skill-tests/仁德.test.ts
// 仁德(刘备)技能测试 — 标准版/国战版:
//   use:出牌阶段,可以将任意张手牌交给其他角色(自己除外)。无发动次数限制。
//       以此法失去第二张牌时,回复 1 点体力(每回合仅回 1 次)。
//   params:targets = [{ target, cardIds }] 或 allocation = [{ target, cardIds }]
//
// 验证:
//   1. 正面:给 1 人 1 张牌 → 给到目标,自己手牌数 -1(不回血)
//   2. 正面:给 1 人 2 张牌 → 自己回 1 血
//   3. 正面:给多人各 1 张 → 总计 2 张,也回 1 血
//   4. 正面:可多次发动(第一次 1 张不回血,第二次再 1 张累计 2 张 → 回血)
//   5. 正面:回血仅一次(累计 ≥2 张后继续给牌不再回血)
//   6. distribute UI 路径(allocation 格式)
//   7. 负面:不给自己(target=自己)→ 拒绝
//   8. 负面:目标牌不在手牌 → 拒绝
//   9. 负面:重复 cardId → 拒绝
//   10. 负面:非自己回合 → 拒绝
//   11. 负面:不出牌(targets=空) → 拒绝
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
    // view 级断言
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].health).toBe(3);
      expect(v.players[0].handCount).toBe(0);
      expect(v.pending).toBeNull();
    });
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
    // view 级断言
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].health).toBe(4);
      expect(v.players[0].handCount).toBe(0);
      expect(v.pending).toBeNull();
    });
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

  // ─── 可多次发动 + 累计回血 ─────────────────────

  it('可多次发动:第一次给 1 张不回血,第二次再给 1 张 → 累计 2 张回血', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const c3 = makeCard('c3', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2', 'c3'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1, c2, c3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次:给 1 张,不回血
    await P1.triggerAction('仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1'] }],
    });
    expect(harness.state.players[1].hand).toContain('c1');
    expect(harness.state.players[0].health).toBe(3);

    // 第二次:再给 1 张,累计 2 张 → 回血
    await P1.triggerAction('仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c2'] }],
    });
    expect(harness.state.players[1].hand).toContain('c2');
    expect(harness.state.players[0].health).toBe(4);
  });

  it('回血仅一次:累计 ≥2 张后继续给牌不再回血', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const c3 = makeCard('c3', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2', 'c3'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1, c2, c3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 一次给 2 张 → 回血到满血
    await P1.triggerAction('仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1', 'c2'] }],
    });
    expect(harness.state.players[0].health).toBe(4);

    // 再给 1 张 → 不再回血(仍满血 4,不能超过上限)
    await P1.triggerAction('仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c3'] }],
    });
    expect(harness.state.players[1].hand).toContain('c3');
    expect(harness.state.players[0].health).toBe(4);
  });

  it('可多次发动:分三次各给 1 张,第三次累计 3 张(第二次已回血,第三次不再回)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const c3 = makeCard('c3', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2', 'c3'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1, c2, c3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 三次各 1 张
    await P1.triggerAction('仁德', 'use', { targets: [{ target: 1, cardIds: ['c1'] }] });
    expect(harness.state.players[0].health).toBe(3); // 1 张不回
    await P1.triggerAction('仁德', 'use', { targets: [{ target: 1, cardIds: ['c2'] }] });
    expect(harness.state.players[0].health).toBe(4); // 累计 2 张回血
    await P1.triggerAction('仁德', 'use', { targets: [{ target: 1, cardIds: ['c3'] }] });
    expect(harness.state.players[0].health).toBe(4); // 已回过,不再回
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']));
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
