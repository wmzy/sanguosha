// 行殇(曹丕·被动技)测试
//   当其他角色死亡时,你可以获得其所有牌(手牌、装备牌、判定区牌)。
//
// 验证:
//   1. 端到端:P0(曹丕)发动行殇 → 获得 P1(死亡)的所有手牌
//   2. 端到端:同时获得装备区牌
//   3. 端到端:同时获得判定区牌(延时锦囊)
//   4. 不发动:可以选择不拿牌(行殇是主动发动)
//   5. 边界:无牌死亡角色不触发行殇
//   6. 边界:官方为「其他角色」死亡——曹丕自己死亡不触发行殇
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, makeCard, makePlayer as sharedMakePlayer } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { runDeathFlow } from '../../src/engine/flows/death';
import type { GameState, PlayerState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: PlayerState['equipment'];
  skills?: string[];
  pendingTricks?: PlayerState['pendingTricks'];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return sharedMakePlayer({ character: '曹丕', ...opts });
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

    // P1 即将死亡(模拟过河拆桥等致死场景:直接走死亡流程 runDeathFlow)
    // runDeathFlow 在 死亡时 时机询问行殇,随后 系统处理牌 清理手牌/装备
    void runDeathFlow(harness.state, 1);
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

    void runDeathFlow(harness.state, 1);
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('行殇', { choice: true });

    // P0 同时获得手牌 + 装备
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['h1', 'w1']));
    expect(harness.state.players[0].hand.length).toBe(2);
    // P1 装备清空
    expect(harness.state.players[1].equipment).toEqual({});
  });

  // ─── 端到端:同时获得判定区牌(延时锦囊) ────────────────────
  it('发动行殇同时获得判定区牌(乐不思蜀)', async () => {
    const trickCard = makeCard('t1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const hand = makeCard('h1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['行殇'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['h1'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card: trickCard }],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { t1: trickCard, h1: hand },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void runDeathFlow(harness.state, 1);
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('行殇', { choice: true });

    // P0 同时获得手牌 + 判定区牌(延时锦囊牌进入手牌)
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['h1', 't1']));
    expect(harness.state.players[0].hand.length).toBe(2);
    // P1 判定区清空(移除延时锦囊)
    expect(harness.state.players[1].pendingTricks).toEqual([]);
  });

  // ─── 端到端:判定区延时锦囊实体牌已在弃牌堆(真实对局常态) ────────────────────
  it('发动行殇:判定区延时锦囊实体牌从弃牌堆移入发动者手牌(不复制)', async () => {
    const trickCard = makeCard('t2', '乐不思蜀', '♠', 'A', '锦囊牌');
    const hand = makeCard('h2', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['行殇'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['h2'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card: trickCard }],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { t2: trickCard, h2: hand },
      // 实体牌在使用乐不思蜀时已入弃牌堆,判定区只剩快照
      zones: { deck: [], discardPile: ['t2'], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void runDeathFlow(harness.state, 1);
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('行殇', { choice: true });

    // 判定区牌(实体在弃牌堆)随行殇移入 P0 手牌:恰好一张,不复制
    expect(harness.state.players[0].hand.filter((id) => id === 't2')).toHaveLength(1);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['h2', 't2']));
    expect(harness.state.players[0].hand.length).toBe(2);
    // P1 判定区清空;实体牌离开弃牌堆(移动而非复制)
    expect(harness.state.players[1].pendingTricks).toEqual([]);
    expect(harness.state.zones.discardPile).not.toContain('t2');
    expect(harness.state.zones.discardPile.filter((id) => id === 't2')).toHaveLength(0);
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

    void runDeathFlow(harness.state, 1);
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('行殇', { choice: false }); // 不发动

    // P0 未获得牌
    expect(harness.state.players[0].hand).toEqual([]);
    // 牌进入弃牌堆(系统处理牌 自身行为)
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

    void runDeathFlow(harness.state, 1);
    await harness.waitForStable();
    // 无 pending(没询问行殞)
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

    void runDeathFlow(harness.state, 0);
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].alive).toBe(false);
  });
});
