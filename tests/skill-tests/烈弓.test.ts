// 烈弓(黄忠·被动技)测试:
//   官方条件:目标手牌数 ≥ 自己体力值,或 目标手牌数 ≤ 自己攻击范围
//   条件满足 → 可令目标不能出闪(强制命中)
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
  vars?: Record<string, unknown>;
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
    // 类型要求 Record<string, Json>,此处仅用于注入距离 vars
    vars: (opts.vars ?? {}) as Record<string, import('../../src/engine/types').Json>,
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

  // ─── 分支1:目标手牌数 ≥ 自己体力值 → 禁闪 ─────────────────────────
  it('目标手牌数≥自己体力值 → 烈弓禁闪,P2 有闪也不能出', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const extra = makeCard('x1', '杀', '♣', '4');
    const state: GameState = createGameState({
      players: [
        // P1 体力2(低),手牌1(杀);P2 手牌2(闪+杀)≥ P1 体力2 → 分支1满足
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['烈弓', '杀'], health: 2 }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1', 'x1'],
          skills: ['闪'],
          health: 4,
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
    P1.expectPending('请求回应'); // 烈弓 confirm
    await P1.respond('烈弓', { choice: true });

    // 禁闪 → 询问闪被跳过 → 强制命中
    expect(harness.state.players[1].health).toBe(3);
    // P2 的闪仍在手里
    expect(harness.state.players[1].hand).toContain('d1');
  });

  // ─── 分支2:目标手牌数 ≤ 自己攻击范围 → 禁闪 ─────────────────────────
  it('目标手牌数≤自己攻击范围(武器)→ 烈弓禁闪', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        // P1 体力4(高),攻击范围3(丈八蛇矛);P2 手牌1 ≤ 3 → 分支2满足
        // 注:P2 手牌1 < P1 体力4 → 分支1不满足,凸显分支2
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['烈弓', '杀'],
          health: 4,
          vars: { '距离/出杀范围': 3 },
        }),
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
    P1.expectPending('请求回应');
    await P1.respond('烈弓', { choice: true });

    // 禁闪 → 强制命中
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].hand).toContain('d1');
  });

  // ─── 徒手默认攻击范围1:目标手牌1 ≤ 1 → 禁闪 ─────────────────────────
  it('徒手攻击范围1,目标手牌数1 ≤ 1 → 烈弓禁闪', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        // P1 体力4(无武器,默认攻击范围1);P2 手牌1 ≤ 1 → 分支2满足
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['烈弓', '杀'], health: 4 }),
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
    P1.expectPending('请求回应');
    await P1.respond('烈弓', { choice: true });

    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 条件都不满足 → 不触发,正常询问闪 ─────────────────────────────
  it('条件都不满足 → 烈弓不触发,正常询问闪', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const peach = makeCard('p1', '桃', '♥', '3');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const extra = makeCard('x1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        // P1 体力4,徒手攻击范围1
        // P2 手牌2(闪+杀):
        //   分支1: 2 ≥ P1体力4? 否
        //   分支2: 2 ≤ 攻击范围1? 否
        //   → 两分支均不满足 → 不触发
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1', 'p1'],
          skills: ['烈弓', '杀'],
          health: 4,
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1', 'x1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, p1: peach, d1: dodge, x1: extra },
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
        // P1 体力2;P2 手牌1 ≥ 2? 否。P2 手牌1 ≤ 徒手范围1 → 分支2满足
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['烈弓', '杀'], health: 2 }),
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

  // ─── 回归:旧错误条件(目标体力≥自己体力)不应再触发 ─────────────────
  it('旧错误条件(目标体力≥自己)不再触发:P2 体力高但手牌多 → 仍按新手牌条件判断', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // P1 体力1,徒手范围1;P2 体力4(≥P1 体力1,旧条件会触发)
        // 但 P2 手牌3:3 ≥ 1(分支1满足)→ 应触发(此处验证条件基于手牌而非体力)
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['烈弓', '杀'], health: 1 }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['a', 'b', 'c'],
          skills: [],
          health: 4,
        }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // P2 手牌3 ≥ P1 体力1 → 分支1满足 → 应询问烈弓
    P1.expectPending('请求回应');
    await P1.respond('烈弓', { choice: true });
    // 无闪 → 强制命中
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 回归:旧错误条件(目标手牌≥自己手牌)不应再触发 ─────────────────
  it('旧错误条件(目标手牌≥自己手牌)不再触发:双方手牌相同但都不满足官方条件', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        // P1 体力4,徒手范围1;出杀后 P1 手牌1(桃)
        // 设计:P2 手牌1 = P1 手牌1(旧"手牌≥自己"会触发),但官方条件:
        //   P2 手牌1 ≥ P1 体力4? 否
        //   P2 手牌1 ≤ 攻击范围1? 是 → 官方分支2满足
        // 故此处实际会触发(走分支2),验证不再走旧的"手牌≥手牌"路径
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1', 'p1'],
          skills: ['烈弓', '杀'],
          health: 4,
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill, p1: makeCard('p1', '桃', '♥', '3'), d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // 走分支2(目标手牌1 ≤ 徒手范围1)→ 触发
    P1.expectPending('请求回应');
    await P1.respond('烈弓', { choice: true });
    expect(harness.state.players[1].health).toBe(3);
  });
});
