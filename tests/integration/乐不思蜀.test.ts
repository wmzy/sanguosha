// tests/integration/乐不思蜀.test.ts
// 集成测试:乐不思蜀(延时锦囊)——判定失败则跳过出牌阶段
//
// 覆盖:
//   1. 判定非♥ → SKIP_TAG 被加 → 阶段开始 出牌 hook 检测到 SKIP_TAG → cancel 当前 atom
//      (出牌阶段被跳过,直接进入 弃牌 阶段)
//   2. 判定♥ → 乐不思蜀 无效(只 移除延时锦囊),不出牌阶段正常进行
//   3. 多次判定(目标身上多个延时锦囊)— 当前只验 单个乐不思蜀
//
// 关键机制(乐不思蜀.ts):
//   阶段开始 判定 before hook:玩家判定区有 乐不思蜀 → applyAtom 判定
//   判定 after hook:读判定牌 suit
//     - ♥ → 移除延时锦囊(无效)
//     - 其它 → 加 SKIP_TAG + 移除延时锦囊
//   阶段开始 出牌 before hook:有 SKIP_TAG → 去标签 + 阶段结束 出牌 + return cancel
//
// 模式:createGameState + registerSkillsFromState + 直接用 applyAtom 推 阶段开始
//   (因为回合管理不直接接管 test setup;我们只测 乐不思蜀 自己的 hook 序列)
import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest, registerSkillsFromState, applyAtom } from '../../src/engine/create-engine';
import { dispatchAndWait, fireTimeoutAndWait, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, PendingTrick } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
  pendingTricks?: PendingTrick[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = '7',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

const SKIP_TAG = '乐不思蜀/跳过出牌';

describe('乐不思蜀:判定失败则跳过出牌', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:判定非♥ → SKIP_TAG 被加 → 阶段开始 出牌 被 cancel
  // ─────────────────────────────────────────────────────────────
  it('用例1:判定牌 ♠ → SKIP_TAG 加 → 阶段开始 出牌 hook cancel,出牌阶段被跳过', async () => {
    // 准备判定牌(♠,非♥)
    const judgeCard: Card = makeCard('jd-1', '杀', '♠', '7');
    const lb: Card = makeCard('lb-1', '乐不思蜀', '♠', '3');

    // P0 持有乐不思蜀(P0 自己就是目标,便于独立测试钩子)
    // P1 用来提供 P0 装备乐不思蜀的场景里用不到,这里只设 P0
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [lb.id],
          equipment: {},
          skills: ['乐不思蜀'],
          pendingTricks: [{ name: '乐不思蜀', source: 1, card: lb }],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], equipment: {}, skills: [] }),
      ],
      cardMap: { [judgeCard.id]: judgeCard, [lb.id]: lb },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    // 验证初始状态:P0 判定区有 乐不思蜀
    expect(state.players[0].pendingTricks.some((t) => t.name === '乐不思蜀')).toBe(true);
    expect(state.players[0].tags ?? []).not.toContain(SKIP_TAG);

    // 触发 阶段开始 判定 → 乐不思蜀 hook:有 乐不思蜀 → 先问无懈(超时跳过)→ applyAtom 判定
    // 判定 atom:从 deck 顶翻 judgeCard 到 processing
    // 判定 after hook:读 suit = ♠ → 加 SKIP_TAG + 移除延时锦囊
    void applyAtom(state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(state); // 等到无懈 pending
    await fireTimeoutAndWait(state); // 消耗无懈窗口

    // 判定牌应已被消费:从 deck 到 discardPile(after hook 末尾的 dispose)
    expect(state.zones.deck).not.toContain(judgeCard.id);
    expect(state.zones.discardPile).toContain(judgeCard.id);
    expect(state.zones.processing).not.toContain(judgeCard.id);

    // SKIP_TAG 应被加
    expect(state.players[0].tags ?? []).toContain(SKIP_TAG);
    // 乐不思蜀 已被移除
    expect(state.players[0].pendingTricks.some((t) => t.name === '乐不思蜀')).toBe(false);

    // 触发 阶段开始 出牌 → 乐不思蜀 hook:有 SKIP_TAG → 去标签 + 阶段结束 出牌 + cancel
    const outOfPhaseBefore = state.phase;
    await applyAtom(state, { type: '阶段开始', player: 0, phase: '出牌' });
    // phase 已被推过 阶段结束 → 回合管理的 阶段结束 出牌 after hook 应把 phase 推进
    // (若测试没注册 回合管理,phase 不会自动推进;但 SKIP_TAG 应被消费,这是关键)
    // 由于我们没装 回合管理,phase 仍可能是 '出牌'(因为 阶段结束 事件标记不切 phase)，
    // 但 阶段开始 出牌 的 apply 被 cancel 了(state.phase 没被改)
    expect(state.phase).toBe(outOfPhaseBefore); // phase 不变 → cancel 生效
    // SKIP_TAG 已被去标签
    expect(state.players[0].tags ?? []).not.toContain(SKIP_TAG);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:判定♥ → 乐不思蜀 无效,只移除延时锦囊,SKIP_TAG 不被加
  // ─────────────────────────────────────────────────────────────
  it('用例2:判定牌 ♥ → 乐不思蜀 无效移除,SKIP_TAG 不被加', async () => {
    const judgeCard: Card = makeCard('jd-1', '桃', '♥', 'A');
    const lb: Card = makeCard('lb-1', '乐不思蜀', '♠', '3');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [lb.id],
          equipment: {},
          skills: ['乐不思蜀'],
          pendingTricks: [{ name: '乐不思蜀', source: 1, card: lb }],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], equipment: {}, skills: [] }),
      ],
      cardMap: { [judgeCard.id]: judgeCard, [lb.id]: lb },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    void applyAtom(state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(state); // 等到无懈 pending
    await fireTimeoutAndWait(state); // 消耗无懈窗口

    // 判定♥ → SKIP_TAG 不加
    expect(state.players[0].tags ?? []).not.toContain(SKIP_TAG);
    // 乐不思蜀 已被移除(无效)
    expect(state.players[0].pendingTricks.some((t) => t.name === '乐不思蜀')).toBe(false);
    // 判定牌进弃牌堆
    expect(state.zones.discardPile).toContain(judgeCard.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:判定区无 乐不思蜀 → 整个流程不触发(无 SKIP_TAG、判定牌不消耗)
  // ─────────────────────────────────────────────────────────────
  it('用例3:判定区无 乐不思蜀 → 钩子不触发,牌堆不动', async () => {
    const judgeCard: Card = makeCard('jd-1', '杀', '♠', '7');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          equipment: {},
          skills: ['乐不思蜀'],
          pendingTricks: [], // 无 乐不思蜀
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], equipment: {}, skills: [] }),
      ],
      cardMap: { [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    // 触发 阶段开始 判定 → 钩子看到判定区无 乐不思蜀 → 跳过
    await applyAtom(state, { type: '阶段开始', player: 0, phase: '判定' });

    // 牌堆未动(钩子没 apply 判定 atom)
    expect(state.zones.deck).toContain(judgeCard.id);
    expect(state.zones.discardPile).not.toContain(judgeCard.id);
    expect(state.players[0].tags ?? []).not.toContain(SKIP_TAG);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:端到端——P0 对 P1 出乐不思蜀 → P1 判定区收到 → 判定非♥ → 跳过 P1 出牌
  // ─────────────────────────────────────────────────────────────
  it('用例4:端到端——P0 对 P1 出乐不思蜀 → P1 判定区有 → 下回合 P1 判定非♥ → P1 出牌被跳过', async () => {
    const lb: Card = makeCard('lb-1', '乐不思蜀', '♠', '3');
    // 乐不思蜀生效时,后续 P1 的判定牌
    const judgeCard: Card = makeCard('jd-1', '杀', '♠', '7');

    // P0 持有乐不思蜀和距离(座位距离 1)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [lb.id],
          equipment: {},
          skills: ['乐不思蜀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          equipment: {},
          skills: ['乐不思蜀'], // 拥有 skill 才能装载 判定 hook
        }),
      ],
      cardMap: { [lb.id]: lb, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    // P0 对 P1 出乐不思蜀(距离 1)
    await dispatchAndWait(state, {
      skillId: '乐不思蜀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: lb.id, target: 1 },
      baseSeq: state.seq,
    });

    // P1 判定区收到 乐不思蜀(实际是 source=0)
    expect(state.players[1].pendingTricks.some((t) => t.name === '乐不思蜀')).toBe(true);
    // 原乐不思蜀卡进弃牌堆
    expect(state.zones.discardPile).toContain(lb.id);

    // 模拟 P1 下一个回合进入判定阶段(currentPlayerIndex 切到 1,phase=判定)
    state.currentPlayerIndex = 1;
    state.phase = '判定';
    state.turn.phase = '判定';

    // 触发 阶段开始 判定 → P1 身上的 乐不思蜀 钩子触发 → 先问无懈(超时)→ 判定 ♠
    void applyAtom(state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(state); // 等到无懈 pending
    await fireTimeoutAndWait(state); // 消耗无懈窗口

    // P1 身上的 乐不思蜀 被移除 + SKIP_TAG 被加
    expect(state.players[1].pendingTricks.some((t) => t.name === '乐不思蜀')).toBe(false);
    expect(state.players[1].tags ?? []).toContain(SKIP_TAG);

    // 触发 阶段开始 出牌 → P1 出牌阶段被 cancel(因为 SKIP_TAG 还在)
    await applyAtom(state, { type: '阶段开始', player: 1, phase: '出牌' });
    // SKIP_TAG 被消费
    expect(state.players[1].tags ?? []).not.toContain(SKIP_TAG);
  });
});
