// 行殇(曹丕·被动技)测试
//   当其他角色死亡时,你可以获得其所有牌(手牌、装备牌、判定区牌)。
//
// 验证:
//   1. 端到端:P0(曹丕)发动行殇 → 获得 P1(死亡)的所有手牌
//   2. 端到端:同时获得装备区牌
//   3. 不发动:可以选择不拿牌(行殇是主动发动)
//   4. 边界:无牌死亡角色不触发行殇
//   5. 边界:官方为「其他角色」死亡——曹丕自己死亡不触发行殇
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
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
  equipment?: PlayerState['equipment'];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '曹丕',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('行殇', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 端到端:发动行殇获得手牌 ────────────────────
  it('P0(曹丕)发动行殇 → 获得 P1 死亡角色的所有手牌', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const c2 = makeCard('c2', '闪', '♥', '5');
    const c3 = makeCard('c3', '桃', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['行殇'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c1', 'c2', 'c3'],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1, c2, c3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 即将死亡(模拟过河拆桥等致死场景:直接 applyAtom 击杀)
    // 但 击杀 atom 有 before hook:行殇先询问
    // 直接 applyAtom 走完整管线(before hook 触发)
    void applyAtom(harness.state, { type: '击杀', player: 1 });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('行殇', { choice: true });

    // P0 获得所有手牌
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']));
    expect(harness.state.players[0].hand.length).toBe(3);
    // P1 死亡 + 手牌为空
    expect(harness.state.players[1].alive).toBe(false);
    expect(harness.state.players[1].hand).toEqual([]);
  });

  // ─── 端到端:同时获得装备牌 ────────────────────
  it('发动行殇同时获得装备区牌', async () => {
    const weapon = makeCard('w1', '诸葛连弩', '♣', 'A', '装备牌');
    const hand = makeCard('h1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['行殇'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['h1'],
          equipment: { 武器: 'w1' },
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: weapon, h1: hand },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '击杀', player: 1 });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('行殇', { choice: true });

    // P0 同时获得手牌 + 装备
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['h1', 'w1']));
    expect(harness.state.players[0].hand.length).toBe(2);
    // P1 装备清空
    expect(harness.state.players[1].equipment).toEqual({});
  });

  // ─── 不发动:可以选择不拿牌 ────────────────────
  it('不发动行殇:P0 不获得 P1 的牌(牌进入弃牌堆)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['行殇'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c1'],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '击杀', player: 1 });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('行殇', { choice: false }); // 不发动

    // P0 未获得牌
    expect(harness.state.players[0].hand).toEqual([]);
    // 牌进入弃牌堆(击杀 自身行为)
    expect(harness.state.zones.discardPile).toContain('c1');
    // P1 死亡
    expect(harness.state.players[1].alive).toBe(false);
  });

  // ─── 边界:无牌死亡角色不触发 ────────────────────
  it('P1 无牌死亡:行殇不触发(无询问)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['行殇'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '击杀', player: 1 });
    await harness.waitForStable();
    // 无 pending(没询问行殇)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].alive).toBe(false);
  });

  // ─── 边界:曹丕自己死亡不触发行殇 ────────────────────
  it('曹丕自己死亡:不触发行殇', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['行殇'], health: 1 }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '击杀', player: 0 });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].alive).toBe(false);
  });
});
