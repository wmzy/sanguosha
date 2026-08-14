// 古锭刀(武器,范围 2)技能测试:
//   锁定技,当你使用杀造成伤害时,若目标没有手牌,此伤害+1。
//
// 验证:
//   1. 杀命中 + 古锭刀 + 目标无手牌 → 伤害+1(扣2血)
//   2. 杀命中 + 古锭刀 + 目标有手牌 → 正常伤害(扣1血)
//   3. 杀命中 + 无古锭刀 + 目标无手牌 → 正常伤害(扣1血,对照)
//   4. 决斗伤害 + 古锭刀 → 不触发(仅杀伤害才加伤)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState, Json, PlayerState } from '../../src/engine/types';

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
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as Record<string, Json>,
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('古锭刀:杀造成伤害时目标无手牌则伤害+1', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 杀命中 + 古锭刀 + 目标无手牌 → 扣2血 ───────────────
  it('用例1:P0 古锭刀杀P1(无手牌)→ 锁定技伤害+1,P1 扣2血', async () => {
    const guding: Card = {
      id: 'wp-gd',
      name: '古锭刀',
      suit: '♠',
      color: '黑',
      rank: '2',
      type: '装备牌',
      subtype: '武器',
      range: 2,
    };
    const slash = makeCard('k1', '杀', '♠', '7');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          equipment: { 武器: guding.id },
          skills: ['杀', '装备通用', '古锭刀'],
          vars: { '距离/出杀范围': 2 },
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [guding.id]: guding, [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p1HealthBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 无手牌 → 询问闪 skip;古锭刀是锁定技,自动加伤,无询问
    await P1.pass(); // 确保闪窗口(若有)被清理

    // 锁定技:基础1 + 古锭刀1 = 2
    expect(harness.state.players[1].health).toBe(p1HealthBefore - 2);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 2. 杀命中 + 古锭刀 + 目标有手牌 → 正常伤害(扣1血)─────
  it('用例2:P0 古锭刀杀P1(有手牌)→ 不触发加伤,P1 扣1血', async () => {
    const guding: Card = {
      id: 'wp-gd',
      name: '古锭刀',
      suit: '♠',
      color: '黑',
      rank: '2',
      type: '装备牌',
      subtype: '武器',
      range: 2,
    };
    const slash = makeCard('k1', '杀', '♠', '7');
    const tao = makeCard('t1', '桃', '♥', '3'); // P1 手中有牌(非闪)

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          equipment: { 武器: guding.id },
          skills: ['杀', '装备通用', '古锭刀'],
          vars: { '距离/出杀范围': 2 },
        }),
        makePlayer({ index: 1, name: 'P1', hand: [tao.id], skills: ['闪'] }),
      ],
      cardMap: { [guding.id]: guding, [slash.id]: slash, [tao.id]: tao },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p1HealthBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪(silent 窗口或询问窗口)

    // 目标有手牌 → 古锭刀不触发 → 正常 1 点伤害
    expect(harness.state.players[1].health).toBe(p1HealthBefore - 1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 3. 对照:无古锭刀,杀命中 + 目标无手牌 → 正常伤害 ───
  it('用例3:无古锭刀杀P1(无手牌)→ 正常1点伤害(对照)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          skills: ['杀'],
          vars: { '距离/出杀范围': 1 },
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p1HealthBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    expect(harness.state.players[1].health).toBe(p1HealthBefore - 1);
  });

  // ─── 4. 非杀伤害(决斗)不触发古锭刀 ──────────────────────
  it('用例4:P0 古锭刀 + 决斗P1(无手牌)→ 决斗伤害不触发加伤,扣1血', async () => {
    const guding: Card = {
      id: 'wp-gd',
      name: '古锭刀',
      suit: '♠',
      color: '黑',
      rank: '2',
      type: '装备牌',
      subtype: '武器',
      range: 2,
    };
    const duel: Card = {
      id: 'jd1',
      name: '决斗',
      suit: '♠',
      color: '黑',
      rank: 'A',
      type: '锦囊牌',
    };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [duel.id],
          equipment: { 武器: guding.id },
          skills: ['决斗', '装备通用', '古锭刀'],
          vars: { '距离/出杀范围': 2 },
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['杀'] }),
      ],
      cardMap: { [guding.id]: guding, [duel.id]: duel },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p1HealthBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('决斗', 'jd1', [1]);
    await P1.pass(); // 无懈可击窗口
    await P1.pass(); // 询问杀 → P1 无杀 → 决斗输,受1点伤害(来源牌=决斗)

    // 决斗伤害来源牌非"杀" → 古锭刀不触发 → 正常1点伤害
    expect(harness.state.players[1].health).toBe(p1HealthBefore - 1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
