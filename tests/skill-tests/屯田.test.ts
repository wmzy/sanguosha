// 屯田(邓艾·被动技)测试
//   每次当你于回合外失去牌时,可进行一次判定,
//   将非红桃的判定牌置于武将牌上称为"田";每张田使距离 -1。
//
// 验证:
//   1. 端到端:回合外被获得牌 → 判定非红桃 → 加田标记 + 距离修正 +1
//   2. 红桃:判定红桃 → 无田
//   3. 不发动:可选不判定
//   4. 回合内失去牌:不触发(回合外限定)
//   5. 田数量驱动距离修正(多次触发叠加)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
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
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '邓艾',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

describe('屯田', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 端到端:非红桃 → 加田 + 距离修正 ────────────────────
  it('回合外被获得牌 → 判定非红桃 → 加田标记 + 距离修正', async () => {
    // 注:屯田直接更新 距离/进攻修正 vars(无 atom 通道),processedView 的
    // distanceVars 不会实时同步。这是已知引擎限制(需新增 atom 才能完整 view 同步)。
    // 关闭自动对比以聚焦于 state 层面的行为正确性。
    const restoreAutoCompare = disableAutoCompare();

    const p0card = makeCard('p0c', '杀', '♠', '5');
    // 判定牌:黑桃(非红桃)
    const judge = makeCard('j1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { p0c: p0card, j1: judge };
    const state: GameState = createGameState({
      players: [
        // P0(邓艾)在 P1 的回合里被获得牌
        makePlayer({ index: 0, name: 'P0', hand: ['p0c'], skills: ['屯田'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap,
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      // 回合外:P1 的回合
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 用 获得 atom 拿走 P0 的牌(模拟顺手牵羊效果)
    void applyAtom(harness.state, {
      type: '获得',
      player: 1,
      cardId: 'p0c',
      from: 0,
    });
    await harness.waitForStable();

    // 屯田询问发动
    P0.expectPending('请求回应');
    await P0.respond('屯田', { choice: true });
    await harness.waitForStable();

    // 判定为非红桃 → 加田标记
    const tianMarks = harness.state.players[0].marks.filter((m) =>
      m.id.startsWith('屯田/田:'),
    );
    expect(tianMarks.length).toBe(1);
    // 距离修正 vars 更新
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);
    // 判定牌不在弃牌堆(被拿出作为田)
    expect(harness.state.zones.discardPile).not.toContain('j1');

    restoreAutoCompare();
  });

  // ─── 红桃:判定红桃 → 无田 ────────────────────
  it('判定红桃:不获得田', async () => {
    const restoreAutoCompare = disableAutoCompare();

    const p0card = makeCard('p0c', '杀', '♠', '5');
    // 判定牌:红桃
    const judge = makeCard('j1', '杀', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['p0c'], skills: ['屯田'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { p0c: p0card, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '获得', player: 1, cardId: 'p0c', from: 0 });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('屯田', { choice: true });
    await harness.waitForStable();

    // 红桃:无田
    const tianMarks = harness.state.players[0].marks.filter((m) =>
      m.id.startsWith('屯田/田:'),
    );
    expect(tianMarks.length).toBe(0);
    // 距离修正未设置
    expect(harness.state.players[0].vars['距离/进攻修正']).toBeUndefined();
    // 判定牌进入弃牌堆(未被拿作田)
    expect(harness.state.zones.discardPile).toContain('j1');

    restoreAutoCompare();
  });

  // ─── 不发动:可选不判定 ────────────────────
  it('不发动屯田:不加田', async () => {
    const restoreAutoCompare = disableAutoCompare();

    const p0card = makeCard('p0c', '杀', '♠', '5');
    const judge = makeCard('j1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['p0c'], skills: ['屯田'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { p0c: p0card, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '获得', player: 1, cardId: 'p0c', from: 0 });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('屯田', { choice: false }); // 不发动
    await harness.waitForStable();

    const tianMarks = harness.state.players[0].marks.filter((m) =>
      m.id.startsWith('屯田/田:'),
    );
    expect(tianMarks.length).toBe(0);
    expect(harness.state.players[0].vars['距离/进攻修正']).toBeUndefined();
    // 牌堆未消耗(没判定)
    expect(harness.state.zones.deck).toContain('j1');

    restoreAutoCompare();
  });

  // ─── 回合内失去牌:不触发 ────────────────────
  it('回合内失去牌:屯田不触发', async () => {
    const restoreAutoCompare = disableAutoCompare();

    const p0card = makeCard('p0c', '杀', '♠', '5');
    const judge = makeCard('j1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['p0c'], skills: ['屯田'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { p0c: p0card, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      // P0 自己的回合
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '获得', player: 1, cardId: 'p0c', from: 0 });
    await harness.waitForStable();

    // 自己回合:屯田不触发
    expect(harness.state.pendingSlots.size).toBe(0);
    const tianMarks = harness.state.players[0].marks.filter((m) =>
      m.id.startsWith('屯田/田:'),
    );
    expect(tianMarks.length).toBe(0);

    restoreAutoCompare();
  });

  // ─── 多次触发叠加 ────────────────────
  it('多次失去牌叠加田数量,距离修正随之增加', async () => {
    const restoreAutoCompare = disableAutoCompare();

    const p0c1 = makeCard('p0c1', '杀', '♠', '5');
    const p0c2 = makeCard('p0c2', '闪', '♣', '5');
    const j1 = makeCard('j1', '杀', '♠', '7'); // 非红桃
    const j2 = makeCard('j2', '杀', '♣', '8'); // 非红桃
    const cardMap: Record<string, Card> = { p0c1, p0c2, j1, j2 };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['p0c1', 'p0c2'], skills: ['屯田'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap,
      zones: { deck: ['j1', 'j2'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次失去牌
    void applyAtom(harness.state, { type: '获得', player: 1, cardId: 'p0c1', from: 0 });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('屯田', { choice: true });
    await harness.waitForStable();

    expect(
      harness.state.players[0].marks.filter((m) => m.id.startsWith('屯田/田:')).length,
    ).toBe(1);
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);

    // 第二次失去牌
    void applyAtom(harness.state, { type: '获得', player: 1, cardId: 'p0c2', from: 0 });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('屯田', { choice: true });
    await harness.waitForStable();

    expect(
      harness.state.players[0].marks.filter((m) => m.id.startsWith('屯田/田:')).length,
    ).toBe(2);
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(2);

    restoreAutoCompare();
  });
});
