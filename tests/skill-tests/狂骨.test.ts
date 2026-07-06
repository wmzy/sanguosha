// 狂骨(魏延·锁定技)测试:
//   对距离1以内的角色造成伤害 → 回复1点体力
//   距离>1 → 不回复
//   满血 → 不回复
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json, PlayerState } from '../../src/engine/types';

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
  vars?: Record<string, Json>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '魏延',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('狂骨', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 距离1 → 造成伤害后回复 ─────────────────────────────
  it('对距离1的P2造成伤害 → 魏延回复1点', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['狂骨', '杀'], health: 3 }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // P2 无闪 → pass → 受伤
    await P2.pass();

    // P2 扣血
    expect(harness.state.players[1].health).toBe(3);
    // 狂骨触发:魏延从 3 回复到 4
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─── 满血 → 不回复 ─────────────────────────────
  it('魏延满血 → 造成伤害但不回复(无溢出)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['狂骨', '杀'], health: 4 }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    // 满血不回复
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─── 距离>1 → 不回复(4人局,P0→P2 距离2)─────────────────────
  it('对距离2的P2造成伤害 → 狂骨不触发', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // P0=魏延,出杀范围设为3以能打到 P2(环形距离2)
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['狂骨', '杀'],
          health: 3,
          vars: { '距离/出杀范围': 3 },
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'], health: 4 }),
        makePlayer({ index: 2, name: 'P2', skills: ['闪'], health: 4 }),
        makePlayer({ index: 3, name: 'P3', skills: ['闪'], health: 4 }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    // P0 杀 P2(距离2 > 1)
    await P0.useCardAndTarget('杀', 'k1', [2]);
    await P2.pass();

    expect(harness.state.players[2].health).toBe(3);
    // 距离>1 → 狂骨不回复
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 非魏延造成伤害 → 不触发 ─────────────────────────────
  it('他人(P2)造成伤害 → 魏延(P1)狂骨不触发', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['闪'], health: 4 }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['狂骨', '杀'], health: 3 }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    // P1 出杀打 P0 —— source=P1(狂骨owner)→ 触发(对照用例,确认 source 判断正确)
    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass();

    expect(harness.state.players[0].health).toBe(3);
    // P1 是 source,狂骨触发:3→4
    expect(harness.state.players[1].health).toBe(4);
  });
});
