// tests/skill-tests/断粮.test.ts
// 断粮(徐晃·主动技/转化):黑色基本牌或装备牌当【兵粮寸断】使用;
//   目标手牌数≥自己时无距离限制。
//
// 覆盖:
//   1. 黑色基本牌 → 放置兵粮寸断(距离1内)
//   2. 黑色装备牌 → 放置兵粮寸断
//   3. 目标手牌≥自己 → 无距离限制(距离2也合法)
//   4. 目标手牌<自己 且 距离>1 → 拒绝
//   5. 红色牌 → 拒绝(非黑色)
//   6. 锦囊牌 → 拒绝(非基本/装备)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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
  hand?: string[];
  skills?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
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

describe('断粮', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 黑色基本牌 → 放置兵粮寸断(距离1内)──────────────────
  it('黑色基本牌当兵粮寸断 → 放置到距离1的目标', async () => {
    const kill = makeCard('c1', '杀', '♠', '7'); // 黑色基本牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['断粮'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: kill, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.triggerAction('断粮', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);

    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('兵粮寸断');
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c1');
  });

  // ─── 2. 黑色装备牌 → 放置兵粮寸断 ──────────────────────────
  it('黑色装备牌当兵粮寸断', async () => {
    const equip = makeCard('c1', '寒冰剑', '♠', '2', '装备牌'); // 黑色装备牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['断粮'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: equip, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.triggerAction('断粮', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);

    expect(harness.state.players[1].pendingTricks[0].name).toBe('兵粮寸断');
  });

  // ─── 3. 目标手牌≥自己 → 无距离限制(3人局,距离2)────────────
  it('目标手牌≥自己 → 距离2也合法(无距离限制)', async () => {
    const kill = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // 徐晃 1 张手牌;P2 有 2 张(≥1)→ 距离 P0→P2 = 2 但无限制
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['断粮'] }),
        makePlayer({ index: 1, name: '中间', hand: [], skills: ['回合管理'] }),
        makePlayer({ index: 2, name: '远目标', hand: ['d1', 'd2'], skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: kill,
        d1: makeCard('d1', '闪', '♥', '5'),
        d2: makeCard('d2', '桃', '♦', '3'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.triggerAction('断粮', 'use', { cardId: 'c1', target: 2 });
    await waitForStable(harness.state);

    expect(harness.state.players[2].pendingTricks.length).toBe(1);
    expect(harness.state.players[2].pendingTricks[0].name).toBe('兵粮寸断');
  });

  // ─── 4. 目标手牌<自己 且 距离>1 → 拒绝 ────────────────────
  it('目标手牌<自己 且 距离>1 → 拒绝', async () => {
    const kill = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // 徐晃 2 张;P2 有 0 张(<2)→ 4 人局 0→2 距离=2 > 1 → 拒绝
        makePlayer({ index: 0, name: '徐晃', hand: ['c1', 'c0'], skills: ['断粮'] }),
        makePlayer({ index: 1, name: '中间A', hand: [], skills: ['回合管理'] }),
        makePlayer({ index: 2, name: '远目标', hand: [], skills: ['回合管理'] }),
        makePlayer({ index: 3, name: '中间B', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: kill,
        c0: makeCard('c0', '闪', '♥', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.expectRejected({
      skillId: '断粮',
      actionType: 'use',
      params: { cardId: 'c1', target: 2 },
    });
  });

  // ─── 5. 红色牌 → 拒绝(非黑色)──────────────────────────────
  it('红色基本牌 → 拒绝', async () => {
    const red = makeCard('c1', '杀', '♥', '7'); // 红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['断粮'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: red, d1: makeCard('d1', '闪', '♠', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.expectRejected({
      skillId: '断粮',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 6. 黑色锦囊牌 → 拒绝(非基本/装备)──────────────────────
  it('黑色锦囊牌 → 拒绝(只接受基本/装备)', async () => {
    const trick = makeCard('c1', '过河拆桥', '♠', '3', '锦囊牌'); // 黑色但锦囊
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['断粮'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: trick, d1: makeCard('d1', '闪', '♠', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.expectRejected({
      skillId: '断粮',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 7. 对自己 → 拒绝 ───────────────────────────────────
  it('对自己使用 → 拒绝', async () => {
    const kill = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '徐晃', hand: ['c1'], skills: ['断粮'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: kill, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('徐晃');

    await P0.expectRejected({
      skillId: '断粮',
      actionType: 'use',
      params: { cardId: 'c1', target: 0 },
    });
  });
});
