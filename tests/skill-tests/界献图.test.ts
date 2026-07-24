// 界献图(界张松·蜀·被动技,OL 界限突破官方逐字)测试:
//   其他角色出牌阶段开始时,你可以摸至多两张牌,然后交给其等量牌。
//   此阶段结束时,若其造成伤害小于你以此法交给其的牌数,你失去1点体力。
//
// 验证:
//   1. 他人出牌阶段发动:摸 2 → 给 2 → 给牌数记 2
//   2. 他人出牌阶段发动:摸 1 → 给 1
//   3. 他人出牌阶段发动:摸 0(连续两次取消)→ 不摸不给
//   4. 不发动(取消)→ 无副作用
//   5. 阶段结束:伤害 0 < 给牌 2 → owner 失去 1 体力
//   6. 阶段结束:伤害 1 < 给牌 2 → owner 失去 1 体力
//   7. 阶段结束:伤害 2 ≥ 给牌 2 → 不失血
//   8. 阶段结束:伤害 3 > 给牌 2 → 不失血
//   9. 给牌 0 → 阶段结束不失血
//   10. owner 给出的牌进入 currentPlayer 手牌
//   11. owner 死亡 → 不触发
//   12. 当前回合角色死亡 → 不触发
//   13. 伤害统计仅在出牌阶段(模拟准备阶段伤害不计)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
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
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

interface BuildOpts {
  p0Health?: number;
  p0Hand?: string[];
  p0Alive?: boolean;
  p1Hand?: string[];
  p1Alive?: boolean;
  currentPlayer?: number;
  phase?: TurnPhase;
  round?: number;
  extraCards?: Record<string, Card>;
  deck?: string[];
}

function buildState(opts: BuildOpts = {}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: '界张松',
        character: '界张松',
        health: opts.p0Health ?? 3,
        maxHealth: 3,
        alive: opts.p0Alive ?? true,
        hand: opts.p0Hand ?? [],
        skills: ['界献图'],
      }),
      makePlayer({
        index: 1,
        name: 'P1',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: opts.p1Alive ?? true,
        hand: opts.p1Hand ?? [],
      }),
    ],
    cardMap: opts.extraCards ?? {},
    zones: { deck: opts.deck ?? [], discardPile: [], processing: [] },
    currentPlayerIndex: opts.currentPlayer ?? 1,
    phase: opts.phase ?? '出牌',
    turn: { round: opts.round ?? 1, phase: opts.phase ?? '出牌', vars: {} },
  });
}

/** 触发其他角色(P1)的出牌阶段开始 */
async function triggerPlayStart(harness: SkillTestHarness, player = 1): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '出牌' });
  await harness.waitForStable();
}

/** 触发其他角色(P1)的出牌阶段结束 */
async function triggerPlayEnd(harness: SkillTestHarness, player = 1): Promise<void> {
  void applyAtom(harness.state, { type: '阶段结束', player, phase: '出牌' });
  await harness.waitForStable();
}

describe('界献图(OL 界限突破版)', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 发动:摸 2 → 给 2 ─────────
  it('他人出牌阶段发动:摸 2 → 给 2', async () => {
    // P0 手牌已有 2 张(给牌用),deck 顶 2 张(摸牌用)
    const h1 = makeCard('h1', '杀', '♠', '2', '基本牌');
    const h2 = makeCard('h2', '闪', '♦', '3', '基本牌');
    const d1 = makeCard('d1', '桃', '♥', '5', '基本牌');
    const d2 = makeCard('d2', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p0Hand: ['h1', 'h2'],
      extraCards: { h1, h2, d1, d2 },
      deck: ['d1', 'd2'], // 末尾为顶,先摸 d2 再摸 d1
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    // 1) 是否发动
    P0.expectPending('请求回应');
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    // 2) 摸 2 张?→ 是
    P0.expectPending('请求回应');
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    // 3) 选 2 张手牌给 P1
    P0.expectPending('请求回应');
    await P0.respond('界献图', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    // P0 摸了 2 张(d1, d2),给了 2 张(h1, h2)
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.players[0].hand).toContain('d2');
    expect(harness.state.players[0].hand).not.toContain('h1');
    expect(harness.state.players[0].hand).not.toContain('h2');
    // P1 收到 h1, h2
    expect(harness.state.players[1].hand).toContain('h1');
    expect(harness.state.players[1].hand).toContain('h2');
    // turn.vars 记录给牌数 = 2
    expect(harness.state.turn.vars['界献图/given/1']).toBe(2);
  });

  // ─── 2. 发动:摸 1 → 给 1 ─────────
  it('他人出牌阶段发动:摸 1 → 给 1', async () => {
    const h1 = makeCard('h1', '杀');
    const d1 = makeCard('d1', '桃');
    const state = buildState({
      p0Hand: ['h1'],
      extraCards: { h1, d1 },
      deck: ['d1'],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    P0.expectPending('请求回应');
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    // 摸 2 张?→ 否
    P0.expectPending('请求回应');
    await P0.respond('界献图', { choice: false });
    await harness.waitForStable();
    // 摸 1 张?→ 是
    P0.expectPending('请求回应');
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    // P0 手牌现为 d1 + 原 h1(无询问弹窗,因为只有 1 张时跳过?)
    // 不,owner 有 2 张手牌,需弹窗选 1 张给
    P0.expectPending('请求回应');
    await P0.respond('界献图', { cardIds: ['h1'] });
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.players[0].hand).not.toContain('h1');
    expect(harness.state.players[1].hand).toContain('h1');
    expect(harness.state.turn.vars['界献图/given/1']).toBe(1);
  });

  // ─── 3. 发动:摸 0(连续两次取消)→ 不摸不给 ─────────
  it('他人出牌阶段发动:摸 0(连续取消)→ 不摸不给', async () => {
    const h1 = makeCard('h1', '杀');
    const state = buildState({
      p0Hand: ['h1'],
      extraCards: { h1 },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    P0.expectPending('请求回应');
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    // 摸 2?→ 否
    P0.expectPending('请求回应');
    await P0.respond('界献图', { choice: false });
    await harness.waitForStable();
    // 摸 1?→ 否
    P0.expectPending('请求回应');
    await P0.respond('界献图', { choice: false });
    await harness.waitForStable();

    // 无变化
    expect(harness.state.players[0].hand).toEqual(['h1']);
    expect(harness.state.players[1].hand).toEqual([]);
    // 给牌数 = 0
    expect(harness.state.turn.vars['界献图/given/1']).toBe(0);
  });

  // ─── 4. 不发动 → 无副作用 ─────────
  it('不发动(取消)→ 无副作用', async () => {
    const h1 = makeCard('h1', '杀');
    const state = buildState({
      p0Hand: ['h1'],
      extraCards: { h1 },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    P0.expectPending('请求回应');
    await P0.respond('界献图', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toEqual(['h1']);
    expect(harness.state.players[1].hand).toEqual([]);
    // 给牌数未设置(未发动)
    expect(harness.state.turn.vars['界献图/given/1']).toBeUndefined();
  });

  // ─── 5. 阶段结束:伤害 0 < 给牌 2 → 失去 1 体力 ─────────
  it('给 2 张但 P1 未造成伤害 → owner 失去 1 体力', async () => {
    const h1 = makeCard('h1', '杀');
    const h2 = makeCard('h2', '闪');
    const d1 = makeCard('d1', '桃');
    const d2 = makeCard('d2', '杀');
    const state = buildState({
      p0Health: 3,
      p0Hand: ['h1', 'h2'],
      extraCards: { h1, h2, d1, d2 },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    await P0.respond('界献图', { choice: true }); // 摸 2
    await harness.waitForStable();
    await P0.respond('界献图', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    const healthBefore = harness.state.players[0].health;
    // 阶段结束 → 伤害 0 < 2 → 失 1 体力
    await triggerPlayEnd(harness, 1);
    expect(harness.state.players[0].health).toBe(healthBefore - 1);
  });

  // ─── 6. 阶段结束:伤害 1 < 给牌 2 → 失去 1 体力 ─────────
  it('给 2 张,P1 造成 1 伤害 → owner 失去 1 体力', async () => {
    const h1 = makeCard('h1', '杀');
    const h2 = makeCard('h2', '闪');
    const d1 = makeCard('d1', '桃');
    const d2 = makeCard('d2', '杀');
    const state = buildState({
      p0Health: 3,
      p0Hand: ['h1', 'h2'],
      extraCards: { h1, h2, d1, d2 },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    await P0.respond('界献图', { choice: true }); // 摸 2
    await harness.waitForStable();
    await P0.respond('界献图', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    // P1 对 P0 造成 1 点伤害
    void runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();

    const healthBefore = harness.state.players[0].health;
    await triggerPlayEnd(harness, 1);
    // 1 < 2 → 失 1 体力
    expect(harness.state.players[0].health).toBe(healthBefore - 1);
  });

  // ─── 7. 阶段结束:伤害 2 ≥ 给牌 2 → 不失血 ─────────
  it('给 2 张,P1 造成 2 伤害 → owner 不失血', async () => {
    const h1 = makeCard('h1', '杀');
    const h2 = makeCard('h2', '闪');
    const d1 = makeCard('d1', '桃');
    const d2 = makeCard('d2', '杀');
    const state = buildState({
      p0Health: 3,
      p0Hand: ['h1', 'h2'],
      extraCards: { h1, h2, d1, d2 },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    await P0.respond('界献图', { choice: true }); // 摸 2
    await harness.waitForStable();
    await P0.respond('界献图', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    // P1 对 P0 造成 2 点伤害
    void runDamageFlow(harness.state, 1, 0, 2);
    await harness.waitForStable();

    const healthBefore = harness.state.players[0].health;
    await triggerPlayEnd(harness, 1);
    // 2 ≥ 2 → 不失血
    expect(harness.state.players[0].health).toBe(healthBefore);
  });

  // ─── 8. 阶段结束:伤害 3 > 给牌 2 → 不失血 ─────────
  it('给 2 张,P1 造成 3 伤害 → owner 不失血', async () => {
    const h1 = makeCard('h1', '杀');
    const h2 = makeCard('h2', '闪');
    const d1 = makeCard('d1', '桃');
    const d2 = makeCard('d2', '杀');
    const state = buildState({
      p0Health: 3,
      p0Hand: ['h1', 'h2'],
      extraCards: { h1, h2, d1, d2 },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    await P0.respond('界献图', { choice: true }); // 摸 2
    await harness.waitForStable();
    await P0.respond('界献图', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    // P1 对 P0 造成 3 点伤害(超过给牌数 2)
    void runDamageFlow(harness.state, 1, 0, 3);
    await harness.waitForStable();

    const healthBefore = harness.state.players[0].health;
    await triggerPlayEnd(harness, 1);
    expect(harness.state.players[0].health).toBe(healthBefore);
  });

  // ─── 9. 给 0 张 → 阶段结束不失血 ─────────
  it('给 0 张(摸 0)→ 阶段结束不失血', async () => {
    const h1 = makeCard('h1', '杀');
    const state = buildState({
      p0Health: 3,
      p0Hand: ['h1'],
      extraCards: { h1 },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    await P0.respond('界献图', { choice: false }); // 不摸 2
    await harness.waitForStable();
    await P0.respond('界献图', { choice: false }); // 不摸 1
    await harness.waitForStable();

    const healthBefore = harness.state.players[0].health;
    await triggerPlayEnd(harness, 1);
    expect(harness.state.players[0].health).toBe(healthBefore);
  });

  // ─── 10. 给出的牌进入 currentPlayer 手牌(已在 #1 验证,这里独立断言)─────────
  it('给牌后:cards 进入 P1 手牌,离开 P0 手牌', async () => {
    const h1 = makeCard('h1', '杀');
    const h2 = makeCard('h2', '闪');
    const d1 = makeCard('d1', '桃');
    const d2 = makeCard('d2', '杀');
    const state = buildState({
      p0Hand: ['h1', 'h2'],
      extraCards: { h1, h2, d1, d2 },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayStart(harness, 1);
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    await P0.respond('界献图', { choice: true }); // 摸 2
    await harness.waitForStable();
    await P0.respond('界献图', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    // 验证给出牌的归属
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['d1', 'd2']));
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['h1', 'h2']));
    expect(harness.state.players[1].hand.length).toBe(2);
  });

  // ─── 11. owner 死亡 → 不触发 ─────────
  it('owner 死亡 → 不触发', async () => {
    const state = buildState({
      p0Alive: false,
      p0Hand: [],
      extraCards: {},
      deck: [],
    });
    await harness.setup(state);

    await triggerPlayStart(harness, 1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 12. 当前回合角色死亡 → 不触发 ─────────
  it('当前回合角色死亡 → 不触发', async () => {
    const state = buildState({
      p1Alive: false,
      extraCards: {},
      deck: [],
    });
    await harness.setup(state);

    await triggerPlayStart(harness, 1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 13. 仅出牌阶段的伤害计入(准备阶段伤害不计)─────────
  it('出牌阶段开始前的伤害不计入统计', async () => {
    // 进入出牌阶段之前(state.phase='准备')P1 造成伤害,不计入
    const h1 = makeCard('h1', '杀');
    const h2 = makeCard('h2', '闪');
    const d1 = makeCard('d1', '桃');
    const d2 = makeCard('d2', '杀');
    const state = buildState({
      p0Health: 3,
      p0Hand: ['h1', 'h2'],
      extraCards: { h1, h2, d1, d2 },
      deck: ['d1', 'd2'],
      phase: '准备', // 当前不是出牌阶段
    });
    await harness.setup(state);

    // P1 造成 1 点伤害(在准备阶段,不计入献图统计)
    void runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();

    // 进入出牌阶段:此时献图统计应是 0
    const P0 = harness.player('界张松');
    await triggerPlayStart(harness, 1);
    await P0.respond('界献图', { choice: true });
    await harness.waitForStable();
    await P0.respond('界献图', { choice: true }); // 摸 2
    await harness.waitForStable();
    await P0.respond('界献图', { cardIds: ['h1', 'h2'] });
    await harness.waitForStable();

    // turn.vars[damage/1] 应仍为 undefined(没在出牌阶段累计)
    // 注意:此时 hook 仅在出牌阶段累计,准备阶段的伤害未计入
    expect(harness.state.turn.vars['界献图/damage/1']).toBeUndefined();

    const healthBefore = harness.state.players[0].health;
    await triggerPlayEnd(harness, 1);
    // 给 2 张,出牌阶段伤害 0 → 失血 1
    expect(harness.state.players[0].health).toBe(healthBefore - 1);
  });
});
