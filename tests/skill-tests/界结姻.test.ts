// 界结姻(界孙尚香·主动技·OL 界限突破版)测试:
//   出牌阶段限一次,你可以选择一名男性角色,弃置一张手牌或将一张装备牌置入其装备区,
//   然后你与其中体力值较大的角色摸一张牌,体力值较小的角色回复1点体力。
//
// 验证:
//   1. 弃手牌代价 + owner 体力较低 → owner 回1,目标摸1
//   2. 弃手牌代价 + owner 体力较高 → owner 摸1,目标回1
//   3. 置装备代价 + owner 体力较高 → 装备置入目标 + owner 摸1 + 目标回1
//   4. 置装备代价·可替换原装备
//   5. 【裁定】体力相等 → 双方均不摸牌不回血(仅消耗代价)
//   6. 限一次:同回合第二次被拒绝
//   7. 目标为女性 → 拒绝
//   8. 【OL 差异】目标满血男性 → 允许(不要求"已受伤")
//   9. 非自己回合 → 拒绝
//  10. 置装备代价传非装备牌 → 拒绝
//  11. 手牌为空 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json, TurnPhase } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeEquip(
  id: string,
  name: string,
  subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物',
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character: string;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  hand?: string[];
  skills?: string[];
  equipment?: Record<string, string>;
  vars?: Record<string, Json>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildState(opts: {
  p0Health?: number;
  p0MaxHealth?: number;
  p0Hand?: string[];
  p0Equipment?: Record<string, string>;
  p1Character?: string;
  p1Health?: number;
  p1MaxHealth?: number;
  p1Equipment?: Record<string, string>;
  p2Character?: string;
  p2Health?: number;
  p2MaxHealth?: number;
  extraCards?: Record<string, Card>;
  currentPlayer?: number;
  phase?: TurnPhase;
}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: '界孙尚香',
        character: '界孙尚香',
        health: opts.p0Health ?? 2,
        maxHealth: opts.p0MaxHealth ?? 3,
        hand: opts.p0Hand ?? ['h1', 'h2', 'h3'],
        equipment: opts.p0Equipment,
        skills: ['界结姻'],
      }),
      makePlayer({
        index: 1,
        name: 'P1',
        character: opts.p1Character ?? '曹操',
        health: opts.p1Health ?? 4,
        maxHealth: opts.p1MaxHealth ?? 4,
        equipment: opts.p1Equipment,
      }),
      makePlayer({
        index: 2,
        name: 'P2',
        character: opts.p2Character ?? '甄姬',
        health: opts.p2Health ?? 2,
        maxHealth: opts.p2MaxHealth ?? 3,
      }),
    ],
    cardMap: {
      h1: makeCard('h1', '闪', '♦', '2'),
      h2: makeCard('h2', '杀', '♠', '3'),
      h3: makeCard('h3', '桃', '♥', '4'),
      ...(opts.extraCards ?? {}),
    },
    currentPlayerIndex: opts.currentPlayer ?? 0,
    phase: opts.phase ?? '出牌',
    turn: { round: 1, phase: opts.phase ?? '出牌', vars: {} },
  });
}

describe('界结姻(OL 界限突破版)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 弃手牌 + owner 体力较低 → owner 回1,目标摸1 ─────────
  it('弃手牌:owner(2)<目标(4) → owner 回1(2→3),目标摸1,弃 h1', async () => {
    const state = buildState({ p0Health: 2, p0MaxHealth: 3, p1Health: 4, p1MaxHealth: 4 });
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    const p1HandBefore = harness.state.players[1].hand.length;
    await P0.triggerAction('界结姻', 'use', { cost: '弃手牌', cardIds: ['h1'], target: 1 });

    expect(harness.state.players[0].health).toBe(3); // owner 回1
    expect(harness.state.players[0].hand).toEqual(['h2', 'h3']); // 弃 h1,未摸
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore + 1); // 目标摸1
    expect(harness.state.zones.discardPile).toContain('h1');
    expect(harness.state.players[0].vars['界结姻/usedThisTurn']).toBe(true);
  });

  // ─── 2. 弃手牌 + owner 体力较高 → owner 摸1,目标回1 ─────────
  it('弃手牌:owner(3)>目标(1) → owner 摸1,目标回1(1→2)', async () => {
    const state = buildState({ p0Health: 3, p0MaxHealth: 3, p1Health: 1, p1MaxHealth: 4 });
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    await P0.triggerAction('界结姻', 'use', { cost: '弃手牌', cardId: 'h1', target: 1 });

    expect(harness.state.players[1].health).toBe(2); // 目标回1
    // owner 弃 h1 后摸1:手牌数不变(净0),但 h1 已不在
    expect(harness.state.players[0].hand).not.toContain('h1');
    expect(harness.state.players[0].hand.length).toBe(3);
  });

  // ─── 3. 置装备代价 + owner 体力较高 → 装备置入目标 + 双向效果 ─
  it('置装备:owner(3)>目标(1) → 装备置入目标防具 + owner 摸1 + 目标回1', async () => {
    const state = buildState({
      p0Health: 3,
      p0MaxHealth: 3,
      p0Hand: ['rw'],
      p1Health: 1,
      p1MaxHealth: 4,
      extraCards: { rw: makeEquip('rw', '测试防具', '防具', '♣', '2') },
    });
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    await P0.triggerAction('界结姻', 'use', { cost: '置装备', cardId: 'rw', target: 1 });

    expect(harness.state.players[1].equipment['防具']).toBe('rw'); // 装备置入目标
    expect(harness.state.players[1].health).toBe(2); // 目标回1
    expect(harness.state.players[0].hand).not.toContain('rw'); // rw 已置出
    expect(harness.state.players[0].hand.length).toBe(1); // owner 摸1(净:出1摸1)
  });

  // ─── 4. 置装备代价·可替换原装备 ──────────────────────────
  it('置装备:目标已有防具 → 替换(旧装备入弃牌堆)', async () => {
    const state = buildState({
      p0Health: 3,
      p0MaxHealth: 3,
      p0Hand: ['rw2'],
      p1Health: 1,
      p1MaxHealth: 4,
      p1Equipment: { 防具: 'rw1' },
      extraCards: {
        rw1: makeEquip('rw1', '测试防具甲', '防具', '♣', '2'),
        rw2: makeEquip('rw2', '测试防具乙', '防具', '♣', '3'),
      },
    });
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    await P0.triggerAction('界结姻', 'use', { cost: '置装备', cardId: 'rw2', target: 1 });

    expect(harness.state.players[1].equipment['防具']).toBe('rw2');
    expect(harness.state.zones.discardPile).toContain('rw1');
    expect(harness.state.players[1].health).toBe(2); // 目标回1
  });

  // ─── 5.【裁定】体力相等 → 双方均不摸牌不回血 ────────────────
  it('体力相等:owner(2)==目标(2) → 仅弃代价,双方不摸不回', async () => {
    const state = buildState({ p0Health: 2, p0MaxHealth: 3, p1Health: 2, p1MaxHealth: 4 });
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    const p1HandBefore = harness.state.players[1].hand.length;
    await P0.triggerAction('界结姻', 'use', { cost: '弃手牌', cardIds: ['h1'], target: 1 });

    expect(harness.state.players[0].health).toBe(2); // 不回
    expect(harness.state.players[1].health).toBe(2); // 不回
    expect(harness.state.players[0].hand).toEqual(['h2', 'h3']); // 仅弃 h1,不摸
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore); // 不摸
    expect(harness.state.zones.discardPile).toContain('h1');
  });

  // ─── 6. 限一次:同回合第二次被拒绝 ────────────────────────
  it('限一次:已用过 → 第二次被拒绝', async () => {
    const state = buildState({ p0Health: 2, p0MaxHealth: 3, p1Health: 4, p1MaxHealth: 4 });
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    await P0.triggerAction('界结姻', 'use', { cost: '弃手牌', cardIds: ['h1'], target: 1 });
    expect(harness.state.players[0].health).toBe(3);

    await P0.expectRejected({
      skillId: '界结姻',
      actionType: 'use',
      params: { cost: '弃手牌', cardIds: ['h2'], target: 1 },
    });
  });

  // ─── 7. 目标为女性 → 拒绝 ────────────────────────────────
  it('目标为女性(甄姬)→ 拒绝', async () => {
    const state = buildState({});
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    await P0.expectRejected({
      skillId: '界结姻',
      actionType: 'use',
      params: { cost: '弃手牌', cardIds: ['h1'], target: 2 },
    });
    expect(harness.state.players[2].health).toBe(2);
    expect(harness.state.players[0].hand.length).toBe(3);
  });

  // ─── 8.【OL 差异】目标满血男性 → 允许(不要求"已受伤")─────
  it('目标满血男性(曹操 4/4)→ 允许(OL 不要求已受伤)', async () => {
    const state = buildState({ p0Health: 2, p0MaxHealth: 3, p1Health: 4, p1MaxHealth: 4 });
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    await P0.triggerAction('界结姻', 'use', { cost: '弃手牌', cardIds: ['h1'], target: 1 });

    // owner(2)<目标(4) → owner 回1(2→3),目标摸1。发动成功(目标满血不阻止)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].vars['界结姻/usedThisTurn']).toBe(true);
  });

  // ─── 9. 非自己回合 → 拒绝 ────────────────────────────────
  it('非自己回合 → 拒绝', async () => {
    const state = buildState({ currentPlayer: 1 });
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    await P0.expectRejected({
      skillId: '界结姻',
      actionType: 'use',
      params: { cost: '弃手牌', cardIds: ['h1'], target: 1 },
    });
  });

  // ─── 10. 置装备代价传非装备牌 → 拒绝 ──────────────────────
  it('置装备代价传基本牌 → 拒绝', async () => {
    const state = buildState({});
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    await P0.expectRejected({
      skillId: '界结姻',
      actionType: 'use',
      params: { cost: '置装备', cardId: 'h1', target: 1 },
    });
  });

  // ─── 11. 手牌为空 → 拒绝 ──────────────────────────────────
  it('手牌为空 → 拒绝', async () => {
    const state = buildState({ p0Hand: [] });
    await harness.setup(state);
    const P0 = harness.player('界孙尚香');

    await P0.expectRejected({
      skillId: '界结姻',
      actionType: 'use',
      params: { cost: '弃手牌', cardIds: [], target: 1 },
    });
  });
});
