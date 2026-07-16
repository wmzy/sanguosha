// tests/skill-tests/义绝.test.ts
// 义绝(界关羽·蜀·主动技)测试:
//   出牌阶段弃置一张牌 → 令一名其他角色展示所有手牌 → 发起者选一张 → 目标弃之 →
//   若非♥ → 发起者摸一张。(每回合限一次)
//
// 验证:
//   1. 正面:弃牌 + 选非♥牌 → 目标弃牌 + 发起者摸一张
//   2. 正面:选♥牌 → 目标弃牌 + 发起者不摸牌
//   3. 限一次:本回合已用 → 再次使用被拒
//   4. 负面:目标无手牌 → 拒绝
//   5. 负面:对自己使用 → 拒绝
//   6. 负面:非自己回合 → 拒绝
//   7. 负面:无代价牌 → 拒绝
//   8. 超时兜底:发起者不选 → 自动选第一张
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
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

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界关羽',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['义绝'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('义绝', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:弃牌 + 选非♥ → 目标弃牌 + 发起者摸一张 ─────────────

  it('use:弃♠代价 + 选目标♠杀 → 目标弃牌 + 发起者摸一张', async () => {
    const cost = makeCard('c1', '杀', '♠', '7'); // 代价牌(♠,非♥)
    const targetCard = makeCard('t1', '杀', '♠', 'A'); // 目标手牌(♠,非♥)
    const drawCard = makeCard('d1', '闪', '♣', '3'); // 摸牌堆顶
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝', '武圣'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { c1: cost, t1: targetCard, d1: drawCard },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 发动义绝:弃 c1, 目标 P2
    await P1.useCardAndTarget('义绝', 'c1', [1]);

    // 应有义绝选牌 pending(P1 选)
    P1.expectPending('请求回应');

    // P1 选目标的 t1(♠非♥)
    await P1.respond('义绝', { cardId: 't1' });

    // 代价牌 c1 已弃
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c1');
    // 目标 t1 已弃
    expect(harness.state.players[1].hand).not.toContain('t1');
    expect(harness.state.zones.discardPile).toContain('t1');
    // 发起者摸了一张(从牌堆 d1)
    expect(harness.state.players[0].hand).toContain('d1');
  });

  // ─── 正面:选♥ → 目标弃牌 + 发起者不摸牌 ─────────────

  it('use:选目标♥牌 → 目标弃牌 + 发起者不摸牌', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const targetCard = makeCard('t1', '桃', '♥', '5'); // ♥
    const drawCard = makeCard('d1', '闪', '♣', '3'); // 不应被摸
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝', '武圣'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { c1: cost, t1: targetCard, d1: drawCard },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('义绝', 'c1', [1]);
    P1.expectPending('请求回应');
    await P1.respond('义绝', { cardId: 't1' });

    // 目标 t1 已弃
    expect(harness.state.players[1].hand).not.toContain('t1');
    expect(harness.state.zones.discardPile).toContain('t1');
    // 发起者未摸牌(d1 仍在牌堆,不在手牌)
    expect(harness.state.players[0].hand).not.toContain('d1');
  });

  // ─── 限一次 ─────────────────────────────

  it('限一次:本回合已用 → 再次使用被拒', async () => {
    const cost1 = makeCard('c1', '杀', '♠', '7');
    const cost2 = makeCard('c2', '杀', '♠', '8');
    const targetCard = makeCard('t1', '杀', '♠', 'A');
    const drawCard = makeCard('d1', '闪', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], skills: ['义绝', '武圣'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { c1: cost1, c2: cost2, t1: targetCard, d1: drawCard },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次使用:成功
    await P1.useCardAndTarget('义绝', 'c1', [1]);
    await P1.respond('义绝', { cardId: 't1' });

    // 第二次使用:被拒(限一次)
    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'd1', targets: [1] },
    });
  });

  // ─── 负面:各种拒绝条件 ─────────────────────────────

  it('use:目标无手牌 → 拒绝', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: [], skills: [] }),
      ],
      cardMap: { c1: cost },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'c1', targets: [1] },
    });
  });

  it('use:对自己使用 → 拒绝', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { c1: cost, t1: makeCard('t1', '杀', '♠', 'A') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'c1', targets: [0] },
    });
  });

  it('use:非自己回合 → 拒绝', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { c1: cost, t1: makeCard('t1', '杀', '♠', 'A') },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'c1', targets: [1] },
    });
  });

  it('use:无代价牌(空手牌) → 拒绝', async () => {
    const targetCard = makeCard('t1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['义绝'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { t1: targetCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '义绝',
      actionType: 'use',
      params: { cardId: 'nonexistent', targets: [1] },
    });
  });

  // ─── 超时兜底:发起者不选 → 自动选第一张 ─────────────

  it('超时:发起者不选牌 → 自动选目标手牌第一张', async () => {
    const cost = makeCard('c1', '杀', '♠', '7');
    const targetCard1 = makeCard('t1', '杀', '♠', 'A'); // 第一张(非♥)
    const drawCard = makeCard('d1', '闪', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['义绝', '武圣'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { c1: cost, t1: targetCard1, d1: drawCard },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('义绝', 'c1', [1]);
    P1.expectPending('请求回应');

    // 超时:自动选第一张
    await P1.pass();

    // 目标 t1(第一张)被弃
    expect(harness.state.players[1].hand).not.toContain('t1');
    expect(harness.state.zones.discardPile).toContain('t1');
    // ♠非♥ → 发起者摸一张
    expect(harness.state.players[0].hand).toContain('d1');
  });
});
