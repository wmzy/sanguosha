// 肉林(董卓·锁定技)技能测试:
//   你对女性角色/女性角色对你使用【杀】时,目标需连续出两张【闪】才能抵消。
//
// 验证:
//   1. 董卓(男)出杀 → 女性(孙尚香)目标需双闪
//   2. 董卓出杀 → 女性 target 只有一张闪 → 受伤
//   3. 女性(孙尚香)出杀 → 董卓需双闪(镜像)
//   4. 负面:董卓出杀 → 男性 target 一张闪即可(肉林不生效)
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
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character: string;
  hand?: string[];
  skills?: string[];
  health?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 4,
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

describe('肉林', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 董卓出杀 → 女性目标需双闪 ─────────────────────────

  it('董卓(男)出杀 → 孙尚香(女)出两张闪 → 抵消', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const d1 = makeCard('d1', '闪', '♥', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0', character: '董卓',
          hand: ['c1'], skills: ['杀', '肉林'],
        }),
        makePlayer({
          index: 1, name: 'P1', character: '孙尚香',
          hand: ['d1', 'd2'], skills: ['闪'],
        }),
      ],
      cardMap: { c1: slash, d1, d2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const hpBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('杀', 'c1', [1]);

    // 第一轮询问闪
    P1.expectPending('询问闪');
    await P1.respond('闪', { cardId: 'd1' });

    // 肉林:第二轮询问闪
    P1.expectPending('询问闪');
    await P1.respond('闪', { cardId: 'd2' });

    // 两张闪抵消,孙尚香不扣血
    expect(harness.state.players[1].health).toBe(hpBefore);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'd1', 'd2']));
  });

  it('董卓(男)出杀 → 孙尚香(女)只有一张闪 → 第二轮 pass → 受伤', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const d1 = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0', character: '董卓',
          hand: ['c1'], skills: ['杀', '肉林'],
        }),
        makePlayer({
          index: 1, name: 'P1', character: '孙尚香',
          hand: ['d1'], skills: ['闪'],
        }),
      ],
      cardMap: { c1: slash, d1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const hpBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('杀', 'c1', [1]);

    // 第一轮:出闪
    P1.expectPending('询问闪');
    await P1.respond('闪', { cardId: 'd1' });

    // 肉林:第二轮 → pass
    P1.expectPending('询问闪');
    await P1.pass();

    // 只一张闪,未完全抵消 → 受伤
    expect(harness.state.players[1].health).toBe(hpBefore - 1);
  });

  // ─── 女性出杀 → 董卓需双闪(镜像) ───────────────────────

  it('孙尚香(女)出杀 → 董卓(男)需双闪 → 两张闪抵消', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const d1 = makeCard('d1', '闪', '♥', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0', character: '孙尚香',
          hand: ['c1'], skills: ['杀'],
        }),
        makePlayer({
          index: 1, name: 'P1', character: '董卓',
          hand: ['d1', 'd2'], skills: ['闪', '肉林'],
        }),
      ],
      cardMap: { c1: slash, d1, d2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const hpBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('杀', 'c1', [1]);

    // 第一轮
    P1.expectPending('询问闪');
    await P1.respond('闪', { cardId: 'd1' });

    // 肉林:第二轮
    P1.expectPending('询问闪');
    await P1.respond('闪', { cardId: 'd2' });

    // 两张闪抵消
    expect(harness.state.players[1].health).toBe(hpBefore);
  });

  // ─── 负面:董卓出杀 → 男性目标,一张闪即可 ───────────────

  it('董卓(男)出杀 → 男性目标一张闪即抵消(肉林不生效)', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const d1 = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0', character: '董卓',
          hand: ['c1'], skills: ['杀', '肉林'],
        }),
        // 曹操:男性
        makePlayer({
          index: 1, name: 'P1', character: '曹操',
          hand: ['d1'], skills: ['闪'],
        }),
      ],
      cardMap: { c1: slash, d1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const hpBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('杀', 'c1', [1]);

    // 第一轮出闪
    P1.expectPending('询问闪');
    await P1.respond('闪', { cardId: 'd1' });

    // 男性目标:肉林不生效,不应有第二轮询问闪 → 杀已抵消
    expect(harness.state.players[1].health).toBe(hpBefore);
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
