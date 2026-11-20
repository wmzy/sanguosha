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
import { SkillTestHarness, makeCard, makePlayer as sharedMakePlayer } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, GameState, Mark, PlayerState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): PlayerState {
  return sharedMakePlayer({ ...opts, character: opts.character ?? '邓艾' });
}

describe('屯田', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 端到端:非红桃 → 加田 + 距离修正 ────────────────────
  it('回合外被获得牌 → 判定非红桃 → 加田标记 + 距离修正', async () => {
    // 注:判定牌被屯田收作"田"曾致 processedView 与 buildView 漂移(discardPileCount 多 1),
    // 已由「收取判定牌」atom 修复——判定牌去向全程经 atom 投影,auto-compare 保持开启。

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
    // 距离修正 vars 更新(后端 effectiveDistance)
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);
    // 判定牌不在弃牌堆(被拿出作为田)
    expect(harness.state.zones.discardPile).not.toContain('j1');

    // ── 关键:processedView 的 distanceVars 经「加标记」atom 的 distanceVars 通道实时同步。
    P0.expectView((v) => {
      expect(v.players[0].distanceVars?.attackMod).toBe(1);
    });

  });

  // ─── 红桃:判定红桃 → 无田 ────────────────────
  it('判定红桃:不获得田', async () => {

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

  });

  // ─── 不发动:可选不判定 ────────────────────
  it('不发动屯田:不加田', async () => {

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

  });

  // ─── 回合内失去牌:不触发 ────────────────────
  it('回合内失去牌:屯田不触发', async () => {

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

  });

  // ─── 多次触发叠加 ────────────────────
  it('多次失去牌叠加田数量,距离修正随之增加', async () => {

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

    // ── 关键:processedView 的 distanceVars 叠加同步到 2
    P0.expectView((v) => {
      expect(v.players[0].distanceVars?.attackMod).toBe(2);
    });

  });

  // ─── 隔离验证:加标记 atom 的 distanceVars 通道(auto-compare 开启)─────
  // 判定牌被收作"田"的视图漂移已由「收取判定牌」atom 修复,端到端用例的 auto-compare
  // 保持开启。此用例绕开判定流程,直接走「加标记」atom + distanceVars 通道,进一步
  // 隔离证明 distanceVars 通道本身使 buildView 与 processedView 收敛(前后端一致)。
  it('加标记 atom 的 distanceVars 通道:前后端 view 收敛(隔离验证)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: [] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 后端 vars(模拟屯田的 syncDistanceMod):buildView 据此投影 attackMod
    harness.state.players[0].vars['距离/进攻修正'] = 3;
    // 加田标记 + 经 distanceVars 通道同步 view(auto-compare 开启)
    const mark: Mark = { id: '屯田/田:iso', scope: 0, payload: { cardId: 'x' } };
    void applyAtom(harness.state, {
      type: '加标记',
      player: 0,
      mark,
      distanceVars: { attackMod: 3 },
    });
    await harness.waitForStable();
    harness.processAllEvents(); // auto-compare 开启:buildView 权威 vs processedView 增量

    expect(harness.state.players[0].marks.length).toBe(1);
    P0.expectView((v) => {
      expect(v.players[0].marks.length).toBe(1);
      expect(v.players[0].distanceVars?.attackMod).toBe(3);
    });
  });
});
