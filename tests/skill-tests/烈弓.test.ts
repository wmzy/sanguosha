// 烈弓(黄忠·被动技)测试:
//   条件满足(目标体力≥自己 或 手牌数≥自己)→ 可令目标不能出闪
//   条件不满足 → 不触发,正常询问闪
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
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
    character: '黄忠',
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

describe('烈弓', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 体力条件满足 → 禁闪,强制命中 ─────────────────────────────
  it('目标体力≥自己 → 烈弓禁闪,P2 有闪也不能出', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        // P1 体力3 < P2 体力4 → 体力条件满足(出杀后 P1 手牌0,P2 手牌1,手牌条件也满足)
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['烈弓', '杀'], health: 3 }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应'); // 烈弓 confirm
    await P1.respond('烈弓', { choice: true });

    // 禁闪 → 询问闪被跳过 → 强制命中
    expect(harness.state.players[1].health).toBe(3);
    // P2 的闪仍在手里
    expect(harness.state.players[1].hand).toContain('d1');
  });

  // ─── 手牌条件满足(体力不满足)→ 禁闪 ─────────────────────────────
  it('目标手牌数≥自己(体力不满足)→ 烈弓禁闪', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const extra = makeCard('x1', '杀', '♣', '4');
    const state: GameState = createGameState({
      players: [
        // P1 体力4 = P2 体力4(体力相等也满足,但本例用手牌凸显)
        // 出杀后:P1 手牌0,P2 手牌2 → 手牌条件满足
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['烈弓', '杀'], health: 4 }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1', 'x1'],
          skills: ['闪'],
          health: 3,
        }),
      ],
      cardMap: { k1: kill, d1: dodge, x1: extra },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // P2 体力3 < P1 体力4 → 体力不满足;但 P2 手牌2 ≥ P1 手牌0 → 手牌满足
    P1.expectPending('请求回应');
    await P1.respond('烈弓', { choice: true });

    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 条件不满足 → 不触发,正常询问闪 ─────────────────────────────
  it('条件都不满足 → 烈弓不触发,正常询问闪', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const peach = makeCard('p1', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        // P1 体力4,手牌2(杀+桃);出杀后 P1 手牌1(桃)
        // P2 体力3 < 4,P2 手牌0 < 1 → 都不满足
        makePlayer({ index: 0, name: 'P1', hand: ['k1', 'p1'], skills: ['烈弓', '杀'], health: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 3 }),
      ],
      cardMap: { k1: kill, p1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // 条件不满足 → 不询问烈弓,直接进入询问闪
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('询问闪');
  });

  // ─── 条件满足但不发动 → 正常询问闪 ─────────────────────────────
  it('条件满足但不发动 → P2 正常出闪', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['烈弓', '杀'], health: 3 }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    // 不发动烈弓
    await P1.respond('烈弓', { choice: false });

    // 正常询问闪 → P2 出闪抵消
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });
    expect(harness.state.players[1].health).toBe(4);
  });
});
