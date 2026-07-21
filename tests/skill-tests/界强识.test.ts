// 界强识(界张松·蜀·主动技,OL 界限突破官方逐字)测试:
//   出牌阶段开始时,你可观看一名其他角色的手牌并展示其中一张牌,
//   然后你本阶段使用此类别的牌后可摸一张牌。
//
// 验证:
//   1. 阶段开始(出牌)→ 询问发动,接受 → 选目标 → 选展示牌 → 记录类别 + 全员可见展示
//   2. 不发动(取消)→ 无展示、无类别记录
//   3. 无其他有手牌角色 → 不询问
//   4. owner 死亡 → 不触发
//   5. 用同类别牌(从手牌→处理区)→ 询问摸牌,接受 → 摸 1
//   6. 用同类别牌,取消摸牌 → 不摸
//   7. 用不同类别牌 → 不触发摸牌询问
//   8. 非出牌阶段或非自己回合使用同类别牌 → 不触发
//   9. 阶段结束(出牌)→ 清除类别记录(后续出牌不再触发)
//  10. 选目标为自己 → 拒绝;选目标无手牌 → 拒绝
//  11. 选展示牌不在目标手牌 → 拒绝
//  12. 多次用同类别牌 → 每次都询问(本阶段不限次)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
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
  p0Hand?: string[];
  p0Alive?: boolean;
  p1Hand?: string[];
  p1Alive?: boolean;
  p1HasHand?: boolean;
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
        health: 3,
        maxHealth: 3,
        alive: opts.p0Alive ?? true,
        hand: opts.p0Hand ?? [],
        skills: ['界强识'],
      }),
      makePlayer({
        index: 1,
        name: 'P1',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: opts.p1Alive ?? true,
        hand: opts.p1HasHand === false ? [] : (opts.p1Hand ?? []),
      }),
    ],
    cardMap: opts.extraCards ?? {},
    zones: { deck: opts.deck ?? [], discardPile: [], processing: [] },
    currentPlayerIndex: opts.currentPlayer ?? 0,
    phase: opts.phase ?? '出牌',
    turn: { round: opts.round ?? 1, phase: opts.phase ?? '出牌', vars: {} },
  });
}

/** 触发阶段开始(出牌) */
async function triggerPlayPhaseStart(harness: SkillTestHarness, player: number): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '出牌' });
  await harness.waitForStable();
}

describe('界强识(OL 界限突破版)', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 发动:展示一张牌,记录类别 ─────────
  it('发动:选目标→展示其一张基本牌→记录类别=基本牌', async () => {
    // P1 手牌 1 张基本牌(杀);P0 发动强识,选 P1,展示该杀
    const p1Card = makeCard('p1s', '杀', '♠', 'A', '基本牌');
    const state = buildState({
      p1Hand: ['p1s'],
      extraCards: { p1s: p1Card },
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayPhaseStart(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界强识', { choice: true });
    await harness.waitForStable();
    // 选目标 P1
    P0.expectPending('请求回应');
    await P0.respond('界强识', { target: 1 });
    await harness.waitForStable();
    // 选展示牌 p1s
    P0.expectPending('请求回应');
    await P0.respond('界强识', { cardId: 'p1s' });
    await harness.waitForStable();

    // 类别记录为基本牌
    expect(harness.state.players[0].vars['界强识/category']).toBe('基本牌');
    expect(harness.state.players[0].vars['界强识/revealedCard']).toBe('p1s');
    // 展示后牌仍在 P1 手牌(展示只广播身份,不移动)
    expect(harness.state.players[1].hand).toContain('p1s');
  });

  // ─── 2. 不发动(取消)→ 无展示、无类别 ─────────
  it('不发动(取消)→ 无类别记录', async () => {
    const p1Card = makeCard('p1s', '杀', '♠', 'A', '基本牌');
    const state = buildState({
      p1Hand: ['p1s'],
      extraCards: { p1s: p1Card },
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayPhaseStart(harness, 0);
    P0.expectPending('请求回应');
    await P0.respond('界强识', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].vars['界强识/category']).toBeUndefined();
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 3. 无其他有手牌角色 → 不询问 ─────────
  it('无其他有手牌角色 → 不询问', async () => {
    const state = buildState({
      p1HasHand: false,
      extraCards: {},
    });
    await harness.setup(state);

    await triggerPlayPhaseStart(harness, 0);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 4. owner 死亡 → 不触发 ─────────
  it('owner 死亡 → 不触发', async () => {
    const p1Card = makeCard('p1s', '杀');
    const state = buildState({
      p0Alive: false,
      p1Hand: ['p1s'],
      extraCards: { p1s: p1Card },
    });
    await harness.setup(state);

    await triggerPlayPhaseStart(harness, 0);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 5. 同类别使用(基本牌)→ 询问摸牌,接受 → 摸 1 ─────────
  it('用同类别的牌(从手牌→处理区)→ 询问摸牌 → 摸 1', async () => {
    // P0 手牌 1 张基本牌(杀);展示 P1 一张基本牌 → 类别=基本牌
    const p0Card = makeCard('p0s', '杀', '♠', '2', '基本牌');
    const p1Card = makeCard('p1s', '杀', '♠', 'A', '基本牌');
    // deck 顶一张(摸牌用)
    const dTop = makeCard('dTop', '桃', '♥', '5', '基本牌');
    const state = buildState({
      p0Hand: ['p0s'],
      p1Hand: ['p1s'],
      extraCards: { p0s: p0Card, p1s: p1Card, dTop },
      deck: ['dTop'],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    // 发动强识,展示 P1 的杀(基本牌)
    await triggerPlayPhaseStart(harness, 0);
    await P0.respond('界强识', { choice: true });
    await harness.waitForStable();
    await P0.respond('界强识', { target: 1 });
    await harness.waitForStable();
    await P0.respond('界强识', { cardId: 'p1s' });
    await harness.waitForStable();

    // 模拟 owner 使用 p0s(基本牌,从手牌→弃牌堆:无窃可击之类直接入弃)→ 触发摸牌
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'p0s',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    await harness.waitForStable();
    // 应询问摸牌
    P0.expectPending('请求回应');
    await P0.respond('界强识', { choice: true });
    await harness.waitForStable();

    // 摸到 deck 顶 dTop
    expect(harness.state.players[0].hand).toContain('dTop');
  });

  // ─── 6. 同类别使用,取消摸牌 → 不摸 ─────────
  it('用同类别的牌,取消摸牌 → 不摸', async () => {
    const p0Card = makeCard('p0s', '杀', '♠', '2', '基本牌');
    const p1Card = makeCard('p1s', '杀', '♠', 'A', '基本牌');
    const state = buildState({
      p0Hand: ['p0s'],
      p1Hand: ['p1s'],
      extraCards: { p0s: p0Card, p1s: p1Card },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayPhaseStart(harness, 0);
    await P0.respond('界强识', { choice: true });
    await harness.waitForStable();
    await P0.respond('界强识', { target: 1 });
    await harness.waitForStable();
    await P0.respond('界强识', { cardId: 'p1s' });
    await harness.waitForStable();

    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'p0s',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界强识', { choice: false });
    await harness.waitForStable();

    // 不摸牌(hand 为空)
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 7. 不同类别使用 → 不触发摸牌 ─────────
  it('用不同类别的牌 → 不触发摸牌', async () => {
    // 展示 P1 的杀(基本牌),owner 出一张锦囊(过河拆桥)
    const p0Card = makeCard('p0trick', '过河拆桥', '♠', '3', '锦囊牌');
    const p1Card = makeCard('p1s', '杀', '♠', 'A', '基本牌');
    const state = buildState({
      p0Hand: ['p0trick'],
      p1Hand: ['p1s'],
      extraCards: { p0trick: p0Card, p1s: p1Card },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayPhaseStart(harness, 0);
    await P0.respond('界强识', { choice: true });
    await harness.waitForStable();
    await P0.respond('界强识', { target: 1 });
    await harness.waitForStable();
    await P0.respond('界强识', { cardId: 'p1s' });
    await harness.waitForStable();

    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'p0trick',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    await harness.waitForStable();
    // 不应触发摸牌询问
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 8. 非出牌阶段使用同类别 → 不触发 ─────────
  it('非出牌阶段(摸牌)即使类别相同也不触发摸牌', async () => {
    const p0Card = makeCard('p0s', '杀', '♠', '2', '基本牌');
    const p1Card = makeCard('p1s', '杀', '♠', 'A', '基本牌');
    const state = buildState({
      p0Hand: ['p0s'],
      p1Hand: ['p1s'],
      extraCards: { p0s: p0Card, p1s: p1Card },
      deck: [],
      phase: '摸牌',
    });
    // 直接预置类别(跳过发动流程,模拟上阶段已记录)
    state.players[0].vars['界强识/category'] = '基本牌';
    await harness.setup(state);

    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'p0s',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 9. 阶段结束 → 清除类别 ─────────
  it('阶段结束(出牌)→ 清除类别记录', async () => {
    const p0Card = makeCard('p0s', '杀', '♠', '2', '基本牌');
    const p1Card = makeCard('p1s', '杀', '♠', 'A', '基本牌');
    const state = buildState({
      p0Hand: ['p0s'],
      p1Hand: ['p1s'],
      extraCards: { p0s: p0Card, p1s: p1Card },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayPhaseStart(harness, 0);
    await P0.respond('界强识', { choice: true });
    await harness.waitForStable();
    await P0.respond('界强识', { target: 1 });
    await harness.waitForStable();
    await P0.respond('界强识', { cardId: 'p1s' });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['界强识/category']).toBe('基本牌');

    // 阶段结束 → 清除
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['界强识/category']).toBeUndefined();
  });

  // ─── 10. 选目标为自己 → 拒绝;无手牌目标 → 拒绝 ─────────
  it('选目标为自己 → 拒绝', async () => {
    const p1Card = makeCard('p1s', '杀');
    const state = buildState({
      p0Hand: ['p0extra'],
      p1Hand: ['p1s'],
      extraCards: {
        p1s: p1Card,
        p0extra: makeCard('p0extra', '杀'),
      },
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayPhaseStart(harness, 0);
    await P0.respond('界强识', { choice: true });
    await harness.waitForStable();
    // 选目标=自己 → 拒绝
    await P0.expectRejected({
      skillId: '界强识',
      actionType: 'respond',
      params: { target: 0 },
    });
  });

  // ─── 11. 选展示牌不在目标手牌 → 拒绝 ─────────
  it('选展示牌不在目标手牌 → 拒绝', async () => {
    const p1Card = makeCard('p1s', '杀');
    const otherCard = makeCard('other', '闪', '♦', '5', '基本牌');
    const state = buildState({
      p1Hand: ['p1s'],
      extraCards: { p1s: p1Card, other: otherCard },
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayPhaseStart(harness, 0);
    await P0.respond('界强识', { choice: true });
    await harness.waitForStable();
    await P0.respond('界强识', { target: 1 });
    await harness.waitForStable();
    // 选 'other'(不在 P1 手牌)→ 拒绝
    await P0.expectRejected({
      skillId: '界强识',
      actionType: 'respond',
      params: { cardId: 'other' },
    });
  });

  // ─── 12. 多次用同类别牌 → 每次都询问(本阶段不限次)─────────
  it('多次使用同类别牌 → 每次都询问摸牌', async () => {
    // P0 手牌 2 张基本牌;展示 P1 基本牌 → 类别=基本牌
    const p0a = makeCard('p0a', '杀', '♠', '2', '基本牌');
    const p0b = makeCard('p0b', '杀', '♠', '3', '基本牌');
    const p1Card = makeCard('p1s', '杀', '♠', 'A', '基本牌');
    const state = buildState({
      p0Hand: ['p0a', 'p0b'],
      p1Hand: ['p1s'],
      extraCards: { p0a, p0b, p1s: p1Card },
      deck: [],
    });
    await harness.setup(state);
    const P0 = harness.player('界张松');

    await triggerPlayPhaseStart(harness, 0);
    await P0.respond('界强识', { choice: true });
    await harness.waitForStable();
    await P0.respond('界强识', { target: 1 });
    await harness.waitForStable();
    await P0.respond('界强识', { cardId: 'p1s' });
    await harness.waitForStable();

    // 第一次使用同类别(基本牌)
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'p0a',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界强识', { choice: false }); // 不摸
    await harness.waitForStable();

    // 第二次使用同类别 → 仍触发
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'p0b',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界强识', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(0);
  });
});
