// tests/skill-tests/驱虎.test.ts
// 驱虎(荀彧·主动技):出牌阶段限一次,与一名角色拼点。
//   赢→该角色对其攻击范围内另一角色造成1伤害;没赢→该角色对你造成1伤害。
//
// 覆盖:
//   1. 荀彧赢 → 选择目标攻击范围内的角色 → 该角色受伤
//   2. 荀彧没赢 → 荀彧受伤
//   3. 每回合限一次(第二次被拒绝)
//   4. 目标无手牌时被拒绝
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
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
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

describe('驱虎', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 荀彧赢 → 选择目标攻击范围内的角色受伤 ─────────────────
  it('荀彧拼点赢 → 选择 P1 攻击范围内的 P2,P2 受1点伤害', async () => {
    // P0=荀彧 出 K(13);P1=拼点目标 出 2;P2=受害者(在 P1 攻击范围内,距离1)
    const win = makeCard('c1', '杀', '♠', 'K');
    const low = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '荀彧', hand: ['c1'], skills: ['驱虎'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: '目标', hand: ['c2'], skills: ['回合管理'] }),
        makePlayer({ index: 2, name: '受害', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { c1: win, c2: low },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('荀彧');
    const P1 = harness.player('目标');

    // 发动驱虎
    await P0.triggerAction('驱虎', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);

    // P1 选拼点牌
    await P1.respond('驱虎', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 荀彧赢(K>2)→ 询问选目标。P0 选 P2(target 在 P1 攻击范围内,距离1)
    await P0.respond('驱虎', { target: 2 });
    await waitForStable(harness.state);

    // P2 受 1 点伤害(P1 造成)
    expect(harness.state.players[2].health).toBe(3);
    expect(harness.state.players[0].health).toBe(3); // 荀彧未受伤
    expect(harness.state.players[1].health).toBe(4); // 目标未受伤
    // 两张拼点牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
    // 限一次标记
    expect(harness.state.players[0].vars['驱虎/usedThisTurn']).toBe(true);
  });

  // ─── 2. 荀彧没赢 → 荀彧受伤 ──────────────────────────────
  it('荀彧拼点没赢 → 荀彧受1点伤害(目标造成)', async () => {
    const low = makeCard('c1', '杀', '♠', '2');
    const high = makeCard('c2', '闪', '♥', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '荀彧', hand: ['c1'], skills: ['驱虎'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: '目标', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: low, c2: high },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('荀彧');
    const P1 = harness.player('目标');

    await P0.triggerAction('驱虎', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('驱虎', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 2 < K → 没赢 → 荀彧受伤
    expect(harness.state.players[0].health).toBe(2); // 3 - 1
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 3. 平局算"没赢" → 荀彧受伤 ─────────────────────────
  it('拼点平局(相等)→ 算没赢,荀彧受伤', async () => {
    const a1 = makeCard('c1', '杀', '♠', '7');
    const a2 = makeCard('c2', '闪', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '荀彧', hand: ['c1'], skills: ['驱虎'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: '目标', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: a1, c2: a2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('荀彧');
    const P1 = harness.player('目标');

    await P0.triggerAction('驱虎', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('驱虎', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 7 == 7 → 没赢 → 荀彧受伤
    expect(harness.state.players[0].health).toBe(2);
  });

  // ─── 4. 每回合限一次 ────────────────────────────────────
  it('每回合限一次:第二次发动被拒绝', async () => {
    const low = makeCard('c1', '杀', '♠', '2');
    const high = makeCard('c2', '闪', '♥', 'K');
    const extra = makeCard('c3', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '荀彧', hand: ['c1', 'c3'], skills: ['驱虎'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: '目标', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: low, c2: high, c3: extra },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('荀彧');
    const P1 = harness.player('目标');

    // 第一次:成功
    await P0.triggerAction('驱虎', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('驱虎', { cardId: 'c2' });
    await waitForStable(harness.state);
    expect(harness.state.players[0].health).toBe(2);

    // 第二次:被拒绝(usedThisTurn 已设)
    await P0.expectRejected({
      skillId: '驱虎',
      actionType: 'use',
      params: { cardId: 'c3', target: 1 },
    });
  });

  // ─── 5. 目标无手牌 → 拒绝 ───────────────────────────────
  it('目标无手牌 → use 被拒绝', async () => {
    const card = makeCard('c1', '杀', '♠', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '荀彧', hand: ['c1'], skills: ['驱虎'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: '目标', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { c1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('荀彧');

    await P0.expectRejected({
      skillId: '驱虎',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 6. 不是自己回合 → 拒绝 ─────────────────────────────
  it('不是自己回合 → use 被拒绝', async () => {
    const card = makeCard('c1', '杀', '♠', 'K');
    const targetCard = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '荀彧', hand: ['c1'], skills: ['驱虎'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: '目标', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: card, c2: targetCard },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('荀彧');

    await P0.expectRejected({
      skillId: '驱虎',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });
});
