// 界救援(界孙权·主公技)测试:
//   其他吴势力角色于其回合内回复体力时,若其体力值大于等于你,
//   则其可以改为令你回复1点体力,然后其摸一张牌。
//
// OL 官方(hero/442)。与标救援完全不同:
//   标版=孙权濒死求桃,救援者额外回1血(锁定);界版=其他吴角色【其回合内】回复体力时,
//   若其体力≥孙权,其【可选】改为令孙权回1血(替代其原本回复)+ 其摸1张。
//
// 验证:
//   1. happy path:吴角色(甘宁)其回合内回复体力,体力≥孙权 → 询问 → 确认
//      → 孙权回1血,甘宁摸1张,甘宁不回血(原回复被替代)
//   2. 救援者拒绝 → 甘宁正常回复,孙权不变,不摸牌
//   3. 非吴势力回复 → 不触发(正常回复)
//   4. 非该角色回合内回复 → 不触发(正常回复)
//   5. 其体力 < 孙权体力 → 不触发(正常回复)
//   6. 界孙权非主公(座次≠0) → 不触发
//
// 事实来源:OL 官方 hero/442 界孙权·救援
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, Faction, GameState, Json, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  hand?: string[];
  skills?: string[];
  vars?: Record<string, Json>;
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '吴',
  };
}

describe('界救援', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── happy path:吴角色回合内回复 → 确认 → 孙权回血+其摸牌 ────────────

  it('吴角色(甘宁)其回合内回复体力,体力≥孙权 → 确认 → 孙权回1血,甘宁摸1张,甘宁不回血', async () => {
    const draw = makeCard('draw1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        // P0 = 界孙权(主公位 0,吴),体力 2
        makePlayer({
          index: 0,
          name: '界孙权',
          character: '界孙权',
          health: 2,
          maxHealth: 4,
          skills: ['界救援'],
          faction: '吴',
        }),
        // P1 = 甘宁(吴),体力 3(≥孙权 2),救援者;空手牌便于断言摸牌
        makePlayer({
          index: 1,
          name: '甘宁',
          character: '甘宁',
          health: 3,
          maxHealth: 4,
          skills: [],
          faction: '吴',
        }),
      ],
      cardMap: { draw1: draw },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1, // 甘宁的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('甘宁');

    // 甘宁(吴)在其回合内回复体力 → 触发界救援询问
    void applyAtom(harness.state, { type: '回复体力', target: 1, amount: 1, source: 1 });
    await harness.waitForStable();

    // 询问甘宁是否改为令孙权回血
    P1.expectPending('请求回应');
    await P1.respond('界救援', { choice: true });
    await harness.waitForStable();

    // 孙权回1血 2→3;甘宁摸1张;甘宁原回复被替代→保持 3(未到4)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].hand).toEqual(['draw1']);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.deck).toEqual([]);
  });

  // ─── 救援者拒绝 → 甘宁正常回复 ────────────────────────────

  it('救援者选择不发动 → 甘宁正常回复,孙权不变,不摸牌', async () => {
    const draw = makeCard('draw1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孙权',
          character: '界孙权',
          health: 2,
          maxHealth: 4,
          skills: ['界救援'],
          faction: '吴',
        }),
        makePlayer({
          index: 1,
          name: '甘宁',
          character: '甘宁',
          health: 3,
          maxHealth: 4,
          skills: [],
          faction: '吴',
        }),
      ],
      cardMap: { draw1: draw },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('甘宁');

    void applyAtom(harness.state, { type: '回复体力', target: 1, amount: 1, source: 1 });
    await harness.waitForStable();

    P1.expectPending('请求回应');
    await P1.respond('界救援', { choice: false });
    await harness.waitForStable();

    // 甘宁正常回复 3→4;孙权不变;不摸牌
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['draw1']);
  });

  // ─── 非吴势力回复 → 不触发 ────────────────────────────

  it('蜀势力角色其回合内回复 → 界救援不触发(仅吴势力)', async () => {
    const draw = makeCard('draw1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孙权',
          character: '界孙权',
          health: 2,
          maxHealth: 4,
          skills: ['界救援'],
          faction: '吴',
        }),
        // P1 = 蜀势力角色(非吴),体力 3≥孙权,但非吴 → 不触发
        makePlayer({
          index: 1,
          name: '张飞',
          character: '张飞',
          health: 3,
          maxHealth: 4,
          skills: [],
          faction: '蜀',
        }),
      ],
      cardMap: { draw1: draw },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '回复体力', target: 1, amount: 1, source: 1 });
    await harness.waitForStable();

    // 非吴势力 → 界救援不触发:正常回复,不询问、孙权不变、不摸牌
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['draw1']);
  });

  // ─── 非该角色回合内回复 → 不触发 ────────────────────────

  it('吴角色在【非自己回合】回复 → 界救援不触发(须于其回合内)', async () => {
    const draw = makeCard('draw1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孙权',
          character: '界孙权',
          health: 2,
          maxHealth: 4,
          skills: ['界救援'],
          faction: '吴',
        }),
        makePlayer({
          index: 1,
          name: '甘宁',
          character: '甘宁',
          health: 3,
          maxHealth: 4,
          skills: [],
          faction: '吴',
        }),
      ],
      cardMap: { draw1: draw },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, // 孙权的回合(非甘宁回合)
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 甘宁回复体力,但当前是孙权回合 → 不满足"于其回合内"
    void applyAtom(harness.state, { type: '回复体力', target: 1, amount: 1, source: 1 });
    await harness.waitForStable();

    // 不触发:甘宁正常回复,孙权不变,不摸牌
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.zones.deck).toEqual(['draw1']);
  });

  // ─── 其体力 < 孙权体力 → 不触发 ────────────────────────

  it('回复者体力<孙权体力 → 界救援不触发', async () => {
    const draw = makeCard('draw1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        // 孙权体力 4(满),甘宁体力 2 < 4 → 不满足条件
        makePlayer({
          index: 0,
          name: '界孙权',
          character: '界孙权',
          health: 4,
          maxHealth: 4,
          skills: ['界救援'],
          faction: '吴',
        }),
        makePlayer({
          index: 1,
          name: '甘宁',
          character: '甘宁',
          health: 2,
          maxHealth: 4,
          skills: [],
          faction: '吴',
        }),
      ],
      cardMap: { draw1: draw },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '回复体力', target: 1, amount: 1, source: 1 });
    await harness.waitForStable();

    // 甘宁体力(2)<孙权(4)→ 不触发:甘宁正常回复 2→3,孙权不变,不摸牌
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.deck).toEqual(['draw1']);
  });

  // ─── 界孙权非主公(座次≠0) → 不触发 ──────────────────

  it('界孙权不在主公位 → 界救援不触发(主公技限制)', async () => {
    const draw = makeCard('draw1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        // P0 = 甘宁(吴),救援者;占据座次 0
        makePlayer({
          index: 0,
          name: '甘宁',
          character: '甘宁',
          health: 3,
          maxHealth: 4,
          skills: [],
          faction: '吴',
        }),
        // P1 = 界孙权(吴),座次 1 → 非主公位,界救援不生效
        makePlayer({
          index: 1,
          name: '界孙权',
          character: '界孙权',
          health: 2,
          maxHealth: 4,
          skills: ['界救援'],
          faction: '吴',
        }),
      ],
      cardMap: { draw1: draw },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, // 甘宁的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 甘宁(座次0)在其回合内回复;界孙权在座次1(非主公位)→ 界救援不触发
    void applyAtom(harness.state, { type: '回复体力', target: 0, amount: 1, source: 0 });
    await harness.waitForStable();

    // 不触发:甘宁正常回复 3→4,界孙权不变,不摸牌
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.zones.deck).toEqual(['draw1']);
  });
});
