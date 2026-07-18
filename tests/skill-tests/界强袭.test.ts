// 界强袭(界典韦·主动技)测试(界限突破版):
// 核心差异(相对标强袭 src/engine/skills/强袭.ts):
//   1. 每阶段限两次(标版限一次)
//   2. 自伤是"受到1点伤害"(真实伤害事件),不是"失去1点体力"
//   3. 每名其他角色本回合仅能被此法指定一次("本回合内未以此法指定过"去重)
//
// 用例:
//   1. cost=damage:受到1点伤害,对目标造成1点伤害(确认是伤害事件)
//   2. cost=discard(手牌武器):弃武器,对目标造成1点伤害
//   3. cost=discard(装备区武器):卸下并弃置,造成1点伤害
//   4. 限两次:第二次发动可执行(对不同目标),第三次被拒绝
//   5. 目标去重:同一目标本回合第二次发动被拒绝
//   6. validate:不能选自己
//   7. 非出牌阶段/非自己回合 → 拒绝
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
    character: opts.character ?? '界典韦',
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

function buildCount(state: GameState, ownerId: number): number {
  const v = state.players[ownerId]?.vars['界强袭/usedThisTurn'];
  return typeof v === 'number' ? v : 0;
}

function buildTargets(state: GameState, ownerId: number): number[] {
  const v = state.players[ownerId]?.vars['界强袭/targets/usedThisTurn'];
  return Array.isArray(v) ? (v as number[]) : [];
}

describe('界强袭', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── cost=damage:受到1点伤害(真实伤害事件),对目标造成1点伤害 ────
  it('cost=damage:受到1点伤害,对目标造成1点伤害', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界强袭', 'use', { cost: 'damage', target: 1 });

    expect(harness.state.players[0].health).toBe(3); // 受到1点伤害
    expect(harness.state.players[1].health).toBe(3); // 受 1 伤
    expect(buildCount(harness.state, 0)).toBe(1);
    expect(buildTargets(harness.state, 0)).toEqual([1]);
  });

  // ─── cost=discard(手牌武器):弃武器,对目标造成1点伤害 ────────────
  it('cost=discard(手牌武器):弃武器,对目标造成1点伤害', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['w1'], skills: ['界强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界强袭', 'use', { cost: 'discard', target: 1, cardId: 'w1' });

    expect(harness.state.players[0].health).toBe(4); // 未受伤害
    expect(harness.state.players[1].health).toBe(3); // 受 1 伤
    expect(harness.state.players[0].hand).not.toContain('w1');
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(buildCount(harness.state, 0)).toBe(1);
    expect(buildTargets(harness.state, 0)).toEqual([1]);
  });

  // ─── cost=discard(装备区武器):卸下并弃置,造成1点伤害 ────────────
  it('cost=discard(装备区武器):卸下并弃置,造成1点伤害', async () => {
    const weapon = makeWeapon('w1', '青釭剑', '♠', 2);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', equipment: { 武器: 'w1' }, skills: ['界强袭'] }),
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
    await P0.triggerAction('界强袭', 'use', { cost: 'discard', target: 1, cardId: 'w1' });

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
  });

  // ─── 限两次:第二次发动可执行(对不同目标),第三次被拒绝 ────────────
  it('限两次:第二次对不同目标可执行,第三次被拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次:P1
    await P0.triggerAction('界强袭', 'use', { cost: 'damage', target: 1 });
    expect(harness.state.players[1].health).toBe(3);
    expect(buildCount(harness.state, 0)).toBe(1);
    expect(buildTargets(harness.state, 0)).toEqual([1]);

    // 第二次:P2(不同目标)— 应允许
    await P0.triggerAction('界强袭', 'use', { cost: 'damage', target: 2 });
    expect(harness.state.players[2].health).toBe(3);
    expect(buildCount(harness.state, 0)).toBe(2);
    expect(buildTargets(harness.state, 0)).toEqual([1, 2]);

    // 第三次:已达上限 2 → 拒绝(即便有未指定目标 P3)
    await P0.expectRejected({
      skillId: '界强袭',
      actionType: 'use',
      params: { cost: 'damage', target: 1 },
    });
    expect(buildCount(harness.state, 0)).toBe(2);
  });

  // ─── 目标去重:同一目标本回合第二次发动被拒绝 ────────────
  it('目标去重:同一目标本回合第二次发动被拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次:P1 — 允许
    await P0.triggerAction('界强袭', 'use', { cost: 'damage', target: 1 });
    expect(harness.state.players[1].health).toBe(3);

    // 第二次:再次对 P1 — 应被拒绝(去重)
    await P0.expectRejected({
      skillId: '界强袭',
      actionType: 'use',
      params: { cost: 'damage', target: 1 },
    });
    expect(harness.state.players[1].health).toBe(3); // 未再次受伤
    expect(buildCount(harness.state, 0)).toBe(1); // 计数未增加
    expect(buildTargets(harness.state, 0)).toEqual([1]);

    // 第二次:对 P2(不同目标)— 应允许(去重不影响其他目标)
    await P0.triggerAction('界强袭', 'use', { cost: 'damage', target: 2 });
    expect(harness.state.players[2].health).toBe(3);
    expect(buildCount(harness.state, 0)).toBe(2);
  });

  // ─── 不能选自己 ────────────────────────────
  it('validate:不能以自己为目标', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界强袭'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界强袭',
      actionType: 'use',
      params: { cost: 'damage', target: 0 },
    });
  });

  // ─── 非出牌阶段/非自己回合 → 拒绝 ────────────────────
  it('非自己回合:拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界强袭'] }),
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
      skillId: '界强袭',
      actionType: 'use',
      params: { cost: 'damage', target: 1 },
    });
  });

  // ─── cost=discard 但非武器牌 → 拒绝 ────────────────────
  it('cost=discard 但 cardId 非武器:拒绝', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['界强袭'] }),
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
      skillId: '界强袭',
      actionType: 'use',
      params: { cost: 'discard', target: 1, cardId: 's1' },
    });
  });
});
