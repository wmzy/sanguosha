// tests/skill-tests/界仁德.test.ts
// 界仁德(界刘备)测试:
//   出牌阶段,每名角色限一次,你可以交给一名其他角色任意张手牌。
//   当你本阶段以此法给出第二张牌时,你可以视为使用一张基本牌(使用杀有次数限制)。
//
// OL 官方。与标仁德区别:
//   - 标仁德:以此法给出第二张时回复1点体力;每名角色无限制。
//   - 界仁德:【不回血】,改为可"视为使用一张基本牌"(杀/桃/酒);每名角色每回合限一次。
//
// 验证:
//   1. 给 1 张牌 → 给到目标,自己手牌数 -1(不触发基本牌询问)
//   2. 给 2 张牌 → 视为使用【杀】(选目标) → virtual kill 命中(无回血)
//   3. 给 2 张牌 → 视为使用【桃】(对已受伤角色) → 回复1点(无自己回血)
//   4. 给 2 张牌 → 视为使用【酒】(对自己) → 标记下一张杀+1(无自己回血)
//   5. 给 2 张牌 → 拒绝使用基本牌 → 无任何效果(不回血)
//   6. 负面:已使用过杀 1 次 → 选杀时不再可用(出杀次数限制)
//   7. 每名角色每回合限一次:已给过的目标拒绝再次给牌
//   8. 跨多次给牌累计:第一次给 1 张不触发,第二次再给 1 张(累计 2)→ 触发
//
// 事实来源:OL 官方 界刘备·仁德
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, Faction, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界刘备',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界仁德'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction ?? '蜀',
  };
}

describe('界仁德', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 给1张:不触发基本牌询问 ─────────────────────────────

  it('给 1 张牌 → 目标拿到牌,自己手牌数 -1,不触发基本牌询问', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1'] }],
    });

    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[1].hand).toContain('c1');
    // 1 张牌 → 不触发基本牌询问(无 pending)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 给2张:选杀 → virtual kill 命中 ───────────────────────

  it('给 2 张牌 → 视为使用【杀】(选目标) → 命中(无自己回血)', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [] }),
        // P2 在 P3 攻击范围内(P3 座次 2,徒手范围 1,可对相邻座次 1)
        makePlayer({ index: 2, name: 'P3', hand: [], skills: [], faction: '群' }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1', 'c2'] }],
    });

    // 询问视为使用基本牌
    expect(harness.state.pendingSlots.get(0)?.atom.type).toBe('请求回应');
    // 选杀
    await P1.respond('界仁德', { choice: '杀' });
    await harness.waitForStable();

    // 选目标(攻击范围 1 内一名其他角色)→ P2(座次1,相邻可攻击)
    await P1.triggerAction('界仁德', 'respond', { targets: [1] });
    await harness.waitForStable();

    // virtualKill → P2 被询问闪;不出闪
    harness.player('P2').expectPending('询问闪');
    await harness.player('P2').pass();
    await harness.waitForStable();

    // P2 拿到 2 张给牌
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
    // 自己不回血(界仁德已移除回血)
    expect(harness.state.players[0].health).toBe(3);
    // 视为杀命中 P2 → 扣血
    expect(harness.state.players[1].health).toBe(3);
    // 出杀次数已用 1
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);
    restoreAutoCompare();
  });

  // ─── 给2张:选桃 → virtual heal ─────────────────────────

  it('给 2 张牌 → 视为使用【桃】(对已受伤角色) → 回复1点(无自己回血)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        // 自己满血,避免桃误回自己
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 4, maxHealth: 4 }),
        // P2 受伤(2/4),桃目标
        makePlayer({ index: 1, name: 'P2', hand: [], health: 2, maxHealth: 4 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1', 'c2'] }],
    });

    // 选桃
    await P1.respond('界仁德', { choice: '桃' });
    await harness.waitForStable();

    // 选桃目标 P2(已受伤)
    await P1.triggerAction('界仁德', 'respond', { targets: [1] });
    await harness.waitForStable();

    // P2 拿到 2 张给牌
    expect(harness.state.players[1].hand.length).toBe(2);
    // P2 回 1 血 2→3
    expect(harness.state.players[1].health).toBe(3);
    // 自己不回血(界仁德无自己回血效果)
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─── 给2张:选酒 → mark next 杀+1 ───────────────────────

  it('给 2 张牌 → 视为使用【酒】(对自己) → 标记下一张杀+1伤害(无自己回血)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1', 'c2'] }],
    });

    // 选酒
    await P1.respond('界仁德', { choice: '酒' });
    await harness.waitForStable();

    // 自己不回血(界仁德无回血)
    expect(harness.state.players[0].health).toBe(4);
    // 自己获得 酒/nextKillDamageBonus mark(duration: turn)
    const hasWineMark = harness.state.players[0].marks.some(
      (m) => m.id === '酒/nextKillDamageBonus',
    );
    expect(hasWineMark).toBe(true);
  });

  // ─── 给2张:拒绝使用基本牌 → 无任何效果(不回血) ──────────

  it('给 2 张牌 → 拒绝视为使用基本牌 → 无效果(不回血)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 3, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], health: 3, maxHealth: 4 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1', 'c2'] }],
    });

    // 拒绝使用基本牌(choice=false)
    await P1.respond('界仁德', { choice: false });
    await harness.waitForStable();

    // P2 拿到给牌
    expect(harness.state.players[1].hand.length).toBe(2);
    // 双方体力不变(界仁德不回血,不视为使用基本牌)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].health).toBe(3);
    // 无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 出杀次数限制 ─────────────────────────────────────

  it('负面:本回合已用 1 次杀 → 选杀时不再可用(出杀次数限制)', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: { '杀/usedCount': 1 } }, // 已用 1 次(达上限)
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1', 'c2'] }],
    });

    // 选杀
    await P1.respond('界仁德', { choice: '杀' });
    await harness.waitForStable();

    // 已达出杀上限 → 不发起目标询问(直接结束)
    expect(harness.state.pendingSlots.size).toBe(0);
    // 双方体力不变(未出杀)
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(4);
    // 出杀次数未增加
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);
    restoreAutoCompare();
  });

  // ─── 每名角色每回合限一次 ─────────────────────────────

  it('负面:已给过的目标拒绝再次给牌(每名角色每回合限一次)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次:给 P2 一张
    await P1.triggerAction('界仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1'] }],
    });
    expect(harness.state.pendingSlots.size).toBe(0); // 1 张不触发基本牌

    // 第二次:再给 P2 一张 → 拒绝(本回合已给过 P2)
    await P1.expectRejected({
      skillId: '界仁德',
      actionType: 'use',
      params: { targets: [{ target: 1, cardIds: ['c2'] }] },
    });
  });

  // ─── 累计给牌数:第一次1张不触发,第二次再1张触发 ───────

  it('累计:第一次给 1 张不触发,第二次再给另一个人 1 张(累计 2)→ 触发', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P3', hand: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次:给 P2 一张 → 不触发(累计 1)
    await P1.triggerAction('界仁德', 'use', {
      targets: [{ target: 1, cardIds: ['c1'] }],
    });
    expect(harness.state.pendingSlots.size).toBe(0);

    // 第二次:给 P3 一张 → 累计 2 → 触发视为使用基本牌
    await P1.triggerAction('界仁德', 'use', {
      targets: [{ target: 2, cardIds: ['c2'] }],
    });
    expect(harness.state.pendingSlots.get(0)?.atom.type).toBe('请求回应');

    // 拒绝使用基本牌
    await P1.respond('界仁德', { choice: false });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
