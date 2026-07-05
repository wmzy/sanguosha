// 强袭(典韦·主动技)测试
//   出牌阶段:自减 1 体力或弃一张武器牌,对攻击范围内一名角色造成 1 点伤害。每回合限一次。
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
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeWeapon(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  range: number,
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype: '武器', range };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '典韦',
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

describe('强袭', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 自减体力造成伤害 ────────────────────────────
  it('cost=hp:自减 1 体力,对目标造成 1 点伤害', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('强袭', 'use', { cost: 'hp', target: 1 });

    expect(harness.state.players[0].health).toBe(3); // 自减 1
    expect(harness.state.players[1].health).toBe(3); // 受 1 伤
  });

  // ─── 弃手牌武器造成伤害 ────────────────────────────
  it('cost=discard(手牌武器):弃武器,对目标造成 1 点伤害', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['w1'], skills: ['强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('强袭', 'use', { cost: 'discard', target: 1, cardId: 'w1' });

    expect(harness.state.players[0].health).toBe(4); // 未减体力
    expect(harness.state.players[1].health).toBe(3); // 受 1 伤
    expect(harness.state.players[0].hand).not.toContain('w1');
    expect(harness.state.zones.discardPile).toContain('w1');
  });

  // ─── 弃装备区武器造成伤害 ────────────────────────────
  it('cost=discard(装备区武器):卸下并弃置,造成 1 点伤害', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', equipment: { 武器: 'w1' }, skills: ['强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 距离 1(双人),弃装备武器后范围回到 1,仍在范围内
    await P0.triggerAction('强袭', 'use', { cost: 'discard', target: 1, cardId: 'w1' });

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
  });

  // ─── 每回合限一次 ────────────────────────────
  it('每回合限一次:第二次发动被拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('强袭', 'use', { cost: 'hp', target: 1 });
    // 第二次:应被拒绝
    await P0.expectRejected({
      skillId: '强袭',
      actionType: 'use',
      params: { cost: 'hp', target: 1 },
    });
  });

  // ─── 非出牌阶段/非自己回合 → 拒绝 ────────────────────
  it('非自己回合:拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '强袭',
      actionType: 'use',
      params: { cost: 'hp', target: 1 },
    });
  });

  // ─── 攻击范围外 → 拒绝 ────────────────────────────
  it('攻击范围外(无武器,目标距离 2):拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 4 人环座:P0 与 P2 距离 2,徒手范围 1 → 超出
    await P0.expectRejected({
      skillId: '强袭',
      actionType: 'use',
      params: { cost: 'hp', target: 2 },
    });
  });

  // ─── cost=discard 但非武器牌 → 拒绝 ────────────────────
  it('cost=discard 但 cardId 非武器:拒绝', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '强袭',
      actionType: 'use',
      params: { cost: 'discard', target: 1, cardId: 's1' },
    });
  });
});
