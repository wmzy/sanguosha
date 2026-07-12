// tests/integration/乐不思蜀判定跳过.test.ts
// 集成测试:乐不思蜀(延时锦囊)——判定失败则跳过出牌阶段(端到端 + 边角)
//
// 已有 tests/integration/乐不思蜀.test.ts 用 applyAtom 直接驱动钩子;
// 本文件补端到端(dispatch 路径)+ 边角场景:
//   1. 端到端:P0 对 P1 出 乐不思蜀 → 跳 P0→P1 后,P1 判定阶段触发,SKIP_TAG 加,P1 出牌阶段被跳过
//   2. 多个 乐不思蜀 堆叠(罕见但合规)→ 一次判定只解一个,仍能跳过一次出牌
//   3. SKIP_TAG 跨回合不应残留(被去标签后才进弃牌,验证不残留)
//   4. 判定♥ → SKIP_TAG 不加,后续 阶段开始 出牌 不被 cancel(出牌阶段正常进入)
//   5. 判定区同时有 乐不思蜀 + 闪电 → 仅 乐不思蜀 触发判定(闪电无 skill 不触发)
//
// 关键机制:见 乐不思蜀.ts
import { describe, it, expect } from 'vitest';
import { registerSkillsFromState, applyAtom } from '../../src/engine/create-engine';
import { fireTimeoutAndWait, waitForStable } from '../engine-harness';
import { SkillTestHarness } from '../engine-harness';
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

describe('乐不思蜀判定跳过:端到端 + 边角', () => {
  // ─────────────────────────────────────────────────────────────
  // 用例 1:端到端——P0 出 乐不思蜀 给 P1 → P1 下一回合判定非♥ → P1 出牌被跳过
  // ─────────────────────────────────────────────────────────────
  it('用例1:P0 对 P1 出 乐不思蜀 → P1 下一回合判定非♥ → P1 出牌阶段被跳过', async () => {
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '3');
    const judgeCard: Card = makeCard('jd1', '杀', '♠', '7', '基本牌');

    const harness = new SkillTestHarness();
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [lb.id], skills: ['乐不思蜀', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['乐不思蜀'] }),
      ],
      cardMap: { [lb.id]: lb, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P0 对 P1 出 乐不思蜀(dispatch 路径 → 添加延时锦囊 → 进弃牌堆)
    // 乐不思蜀 use validate 要求 params.target (单数),不走 useCardAndTarget
    await P0.triggerAction('乐不思蜀', 'use', { cardId: lb.id, target: 1 });

    // P1 判定区收到 乐不思蜀(source=P0)
    expect(harness.state.players[1].pendingTricks).toHaveLength(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    expect(harness.state.players[1].pendingTricks[0].source).toBe(0);
    // 原 乐不思蜀 牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain(lb.id);

    // 切到 P1 的回合(模拟 turn 推进)
    state.currentPlayerIndex = 1;
    state.phase = '判定';
    state.turn.phase = '判定';

    // P1 触发 阶段开始 判定 → 乐不思蜀 hook:有 乐不思蜀 → 先问无懈(超时)→ applyAtom 判定
    void applyAtom(state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(state); // 等到无懈 pending
    await fireTimeoutAndWait(state); // 消耗无懈窗口

    // 判定 ♠(非♥)→ SKIP_TAG 加 + 移除延时锦囊
    expect(harness.state.players[1].tags ?? []).toContain(SKIP_TAG);
    expect(harness.state.players[1].pendingTricks).toHaveLength(0);
    expect(harness.state.zones.discardPile).toContain(judgeCard.id);

    // P1 触发 阶段开始 出牌 → SKIP_TAG 命中 → 出牌阶段被 cancel
    await applyAtom(state, { type: '阶段开始', player: 1, phase: '出牌' });

    // SKIP_TAG 已被消费
    expect(harness.state.players[1].tags ?? []).not.toContain(SKIP_TAG);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:多个 乐不思蜀 堆叠 → 一次判定只解一个,另一个仍在判定区
  // ─────────────────────────────────────────────────────────────
  it('用例2:判定区两个 乐不思蜀 → 一次判定非♥ → 只解一个,剩一个仍可跳下一次出牌', async () => {
    const lb1: Card = makeCard('lb1', '乐不思蜀', '♠', '3');
    const lb2: Card = makeCard('lb2', '乐不思蜀', '♠', '4');
    const judgeCard: Card = makeCard('jd1', '杀', '♠', '7', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [
            { name: '乐不思蜀', source: 1, card: lb1 },
            { name: '乐不思蜀', source: 1, card: lb2 },
          ],
          skills: ['乐不思蜀'],
        }),
      ],
      cardMap: { [lb1.id]: lb1, [lb2.id]: lb2, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    expect(state.players[0].pendingTricks).toHaveLength(2);

    void applyAtom(state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(state); // 等到无懈 pending
    await fireTimeoutAndWait(state); // 消耗无懈窗口

    // SKIP_TAG 加(因判定 ♠ → 非♥)
    expect(state.players[0].tags ?? []).toContain(SKIP_TAG);
    // 注意:移除延时锦囊 按 name 过滤,同名延时锦囊会一次性被全部移除(实现见 移除延时锦囊.ts)。
    // 所以两个 乐不思蜀 都会被移除。
    expect(state.players[0].pendingTricks).toHaveLength(0);

    // SKIP_TAG 应只生效一次 — 出牌阶段 cancel 后 SKIP_TAG 被去
    await applyAtom(state, { type: '阶段开始', player: 0, phase: '出牌' });
    expect(state.players[0].tags ?? []).not.toContain(SKIP_TAG);
    expect(state.players[0].pendingTricks).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:SKIP_TAG 不残留(出牌 cancel 后 SKIP_TAG 一定被去)
  // ─────────────────────────────────────────────────────────────
  it('用例3:SKIP_TAG 在 cancel 后一定被去(不残留到下一回合)', async () => {
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '3');
    const judgeCard: Card = makeCard('jd1', '杀', '♠', '7', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [{ name: '乐不思蜀', source: 1, card: lb }],
          skills: ['乐不思蜀'],
        }),
      ],
      cardMap: { [lb.id]: lb, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    void applyAtom(state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(state); // 等到无懈 pending
    await fireTimeoutAndWait(state); // 消耗无懈窗口
    expect(state.players[0].tags ?? []).toContain(SKIP_TAG);

    await applyAtom(state, { type: '阶段开始', player: 0, phase: '出牌' });
    // 关键断言:SKIP_TAG 一定被去(不会跨回合残留,否则下一回合出牌又会被跳)
    expect(state.players[0].tags ?? []).not.toContain(SKIP_TAG);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:判定♥ → 不加 SKIP_TAG,后续出牌阶段正常进入(不被 cancel)
  // ─────────────────────────────────────────────────────────────
  it('用例4:判定♥ → SKIP_TAG 不加,出牌阶段正常进入(phase 不变)', async () => {
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '3');
    const judgeCard: Card = makeCard('jd1', '桃', '♥', 'A', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [{ name: '乐不思蜀', source: 1, card: lb }],
          skills: ['乐不思蜀'],
        }),
      ],
      cardMap: { [lb.id]: lb, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    void applyAtom(state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(state); // 等到无懈 pending
    await fireTimeoutAndWait(state); // 消耗无懈窗口

    // 判定♥ → 乐不思蜀 无效移除,SKIP_TAG 不加
    expect(state.players[0].tags ?? []).not.toContain(SKIP_TAG);
    expect(state.players[0].pendingTricks).toHaveLength(0);
    expect(state.zones.discardPile).toContain(judgeCard.id);

    // 后续出牌阶段:无 SKIP_TAG → 不被 cancel → phase 进入 '出牌'(不是 '判定')
    await applyAtom(state, { type: '阶段开始', player: 0, phase: '出牌' });
    expect(state.phase).toBe('出牌');
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5:判定区同时有 乐不思蜀 + 闪电 → 只 乐不思蜀 触发判定,闪电无 skill 不响应
  // ─────────────────────────────────────────────────────────────
  it('用例5:判定区有 乐不思蜀 + 闪电 → 只触发乐不思蜀的判定,闪电不动', async () => {
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '3');
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const judgeCard: Card = makeCard('jd1', '杀', '♠', '7', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [
            { name: '乐不思蜀', source: 1, card: lb },
            { name: '闪电', source: 1, card: sd },
          ],
          skills: ['乐不思蜀'],
        }),
      ],
      cardMap: { [lb.id]: lb, [sd.id]: sd, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await registerSkillsFromState(state);

    void applyAtom(state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(state); // 等到无懈 pending
    await fireTimeoutAndWait(state); // 消耗无懈窗口

    // 乐不思蜀 被解(判定 ♠ 非♥)
    expect(state.players[0].pendingTricks.find((t) => t.name === '乐不思蜀')).toBeUndefined();
    // 闪电 仍在判定区(无 skill 处理 → 不动)
    expect(state.players[0].pendingTricks.find((t) => t.name === '闪电')).toBeDefined();
    // SKIP_TAG 加(因 乐不思蜀 命中)
    expect(state.players[0].tags ?? []).toContain(SKIP_TAG);
    // 判定牌进弃牌堆
    expect(state.zones.discardPile).toContain(judgeCard.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 6:乐不思蜀 验证——使用 validate 拒绝非自己回合 / 非出牌阶段
  // ─────────────────────────────────────────────────────────────
  it('用例6:乐不思蜀 use 在非出牌阶段被 validate 拒绝', async () => {
    const lb: Card = makeCard('lb1', '乐不思蜀', '♠', '3');

    const harness = new SkillTestHarness();
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [lb.id], skills: ['乐不思蜀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'] }),
      ],
      cardMap: { [lb.id]: lb },
      currentPlayerIndex: 0,
      phase: '摸牌', // 非出牌阶段
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 摸牌阶段用 乐不思蜀 → 应被拒绝
    await P0.expectRejected({
      skillId: '乐不思蜀',
      actionType: 'use',
      params: { cardId: lb.id, target: 1 },
    });
    // P1 判定区应为空(没真出)
    expect(harness.state.players[1].pendingTricks).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 7(独有,来自被合并文件):判定区无 乐不思蜀 → 钩子不触发,牌堆不动
  // ─────────────────────────────────────────────────────────────
  it('用例7:判定区无 乐不思蜀 → 钩子不触发,牌堆不动', async () => {
    const judgeCard: Card = makeCard('jd-1', '杀', '♠', '7');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['乐不思蜀'],
          pendingTricks: [], // 无 乐不思蜀
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
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
});
