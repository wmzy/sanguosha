// tests/integration/闪电判定.test.ts
// 集成测试:闪电(延时锦囊)判定
//
// 闪电 skill 已实现(src/engine/skills/cards/闪电.ts):判定♠2-9→3点雷电伤害并移除,
// 否则传递给下家。其 resolve 由 判定阶段 after-hook(registerDelayedTrickHooks)→
// resumeDelayedSettlement → runSettlementPhase 触发,而非直接调 runJudgeFlow。
//
// 覆盖:
//   1. 闪电卡通过 添加延时锦囊 atom 进入/离开判定区
//   2. 闪电与其他延时锦囊(乐不思蜀)并存 → 各自按 name 独立移除
//   3. 判定 atom (judgeType='闪电') 通用 plumbing:翻判定牌→after hooks→进弃牌堆
//      (runJudgeFlow 直接调用不走 CardEffect resolve,故不消耗闪电,验证 atom 层通路)
//   4. 重复添加去重、重新装备、validate 校验
//   5. 端到端:判定阶段触发 → 命中(♠2-9)伤害 / 非命中传递下家
import { describe, it, expect, beforeEach } from 'vitest';
import { registerSkillsFromState } from '../../src/engine/index'
import { applyAtom } from '../../src/engine/core/apply';
import { runJudgeFlow } from '../../src/engine/flows/judge';
import { SkillTestHarness, fireTimeoutAndWait, waitForStable } from '../engine-harness';
import { getAtomDef } from '../../src/engine/core/atom';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, PendingTrick } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
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
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

describe('闪电:延时锦囊判定(plumbing & 端到端)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:添加延时锦囊 atom → 闪电进 P0 判定区
  // ─────────────────────────────────────────────────────────────
  it('用例1:添加延时锦囊 → P0 判定区收到 闪电', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: [] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
      ],
      cardMap: { [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(0);

    await applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 1, card: sd },
    });

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('闪电');
    expect(harness.state.players[0].pendingTricks[0].source).toBe(1);
    expect(harness.state.players[0].pendingTricks[0].card).toEqual(sd);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:移除延时锦囊 atom → 闪电离开判定区
  // ─────────────────────────────────────────────────────────────
  it('用例2:移除延时锦囊 → 闪电离开判定区', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [{ name: '闪电', source: 0, card: sd }],
        }),
      ],
      cardMap: { [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);

    await applyAtom(harness.state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '闪电',
    });

    expect(harness.state.players[0].pendingTricks).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:判定区同时有 闪电 + 乐不思蜀 → 各自按 name 独立
  // ─────────────────────────────────────────────────────────────
  it('用例3:判定区同时有 闪电 + 乐不思蜀 → 各自按 name 独立(移除→再移除)', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♥', 'K');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [
            { name: '闪电', source: 1, card: sd },
            { name: '乐不思蜀', source: 1, card: lb },
          ],
        }),
      ],
      cardMap: { [sd.id]: sd, [lb.id]: lb },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(2);

    // 移除闪电
    await applyAtom(harness.state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '闪电',
    });

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('乐不思蜀');

    // 再移除乐不思蜀 → 判定区清空
    await applyAtom(harness.state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '乐不思蜀',
    });
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:判定 atom (judgeType='闪电') → 翻判定牌进处理区,after hooks 收尾入弃
  // (plumbing 验证:直接调 runJudgeFlow 只走 atom 层翻牌/收尾,不触发闪电 CardEffect
  //  resolve —— resolve 由 判定阶段 after-hook 驱动,故此处闪电不被消耗)
  // ─────────────────────────────────────────────────────────────
  it('用例4:判定 atom 翻判定牌到处理区 → after hooks 收尾入弃;闪电仍在判定区(plumbing)', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const judgeCard: Card = makeCard('jd1', '杀', '♥', '7', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [{ name: '闪电', source: 0, card: sd }],
        }),
      ],
      cardMap: { [sd.id]: sd, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);

    // 触发判定 atom
    await runJudgeFlow(harness.state, 0, '闪电');

    // 判定牌已被翻到处理区后转入弃牌堆(atom 的 afterHooks 收尾)
    expect(harness.state.zones.deck).not.toContain(judgeCard.id);
    expect(harness.state.zones.processing).not.toContain(judgeCard.id);
    expect(harness.state.zones.discardPile).toContain(judgeCard.id);

    // 闪电仍在判定区(runJudgeFlow 直接调用不触发 CardEffect resolve → 不移除)
    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('闪电');
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5:重复添加同 trick name → 去重
  // ─────────────────────────────────────────────────────────────
  it('用例5:重复添加 闪电 → 去重,不进第二条(原 source/卡保持)', async () => {
    const sd1: Card = makeCard('sd1', '闪电', '♠', 'A');
    const sd2: Card = makeCard('sd2', '闪电', '♠', 'K');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [{ name: '闪电', source: 1, card: sd1 }],
        }),
      ],
      cardMap: { [sd1.id]: sd1, [sd2.id]: sd2 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);

    // 用 sd2 再添加一次(同 trick name)
    await applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 2, card: sd2 },
    });

    // 仍只有 1 条,原 sd1 / source=1 保持不变
    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].card.id).toBe(sd1.id);
    expect(harness.state.players[0].pendingTricks[0].source).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 6:同一玩家同回合:闪电判定 + 乐不思蜀判定 互不影响
  // (因为是不同延时锦囊,各自独立)
  // ─────────────────────────────────────────────────────────────
  it('用例6:闪电判定 + 乐不思蜀判定 各自独立(消耗一张不影响另一张)', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const lb: Card = makeCard('lb1', '乐不思蜀', '♥', 'K');
    const jd1: Card = makeCard('jd1', '杀', '♠', '7', '基本牌');
    const jd2: Card = makeCard('jd2', '桃', '♥', 'A', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [
            { name: '闪电', source: 1, card: sd },
            { name: '乐不思蜀', source: 1, card: lb },
          ],
        }),
      ],
      cardMap: {
        [sd.id]: sd,
        [lb.id]: lb,
        [jd1.id]: jd1,
        [jd2.id]: jd2,
      },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [jd1.id, jd2.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);

    // 第一张判定牌:用于 闪电
    await runJudgeFlow(harness.state, 0, '闪电');
    expect(harness.state.zones.discardPile).toContain(jd1.id);
    expect(harness.state.zones.processing).not.toContain(jd1.id);

    // 第二张判定牌:用于 乐不思蜀
    await runJudgeFlow(harness.state, 0, '乐不思蜀');
    expect(harness.state.zones.discardPile).toContain(jd2.id);
    expect(harness.state.zones.processing).not.toContain(jd2.id);

    // 两张判定牌都进了弃牌堆,牌堆清空
    expect(harness.state.zones.deck).toHaveLength(0);
    expect(harness.state.zones.discardPile).toHaveLength(2);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 7:判定区被移除 闪电 → 重新装备 → 正常入判定区
  // ─────────────────────────────────────────────────────────────
  it('用例7:移除 闪电 → 重新装备 → 闪电再次进判定区', async () => {
    const sd1: Card = makeCard('sd1', '闪电', '♠', 'A');
    const sd2: Card = makeCard('sd2', '闪电', '♠', 'K');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [{ name: '闪电', source: 1, card: sd1 }],
        }),
      ],
      cardMap: { [sd1.id]: sd1, [sd2.id]: sd2 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);

    // 移除 闪电
    await applyAtom(harness.state, {
      type: '移除延时锦囊',
      player: 0,
      trickName: '闪电',
    });
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);

    // 重新装备 闪电(sd2)
    await applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 2, card: sd2 },
    });
    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].card.id).toBe(sd2.id);
    expect(harness.state.players[0].pendingTricks[0].source).toBe(2);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 8:validate 拒绝——给不存在的玩家添加延时锦囊
  // ─────────────────────────────────────────────────────────────
  it('用例8:applyAtom(添加延时锦囊) → player 不存在时 validate 拒绝', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');

    const state: GameState = createGameState({
      players: [makePlayer({ index: 0, name: 'P0' })],
      cardMap: { [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await registerSkillsFromState(state);

    // validate 直接调用:不存在的 player=5 → 应返回错误字符串
    const def = getAtomDef('添加延时锦囊');
    const err = def.validate(state, {
      type: '添加延时锦囊',
      player: 5,
      trick: { name: '闪电', source: 0, card: sd },
    });
    expect(err).not.toBeNull();
    expect(String(err)).toContain('player 5 not found');
    // 没真正进判定区
    expect(state.players[0].pendingTricks).toHaveLength(0);
  });
});
// ── 以下为从 lightning-judge.test.ts 合并的判定 plumbing 测试 ──

describe('闪电:延时锦囊判定(判定→黑桃→伤害端到端)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:装备(添加延时锦囊)→ 闪电进 P0 判定区
  // ─────────────────────────────────────────────────────────────
  it('用例1:添加延时锦囊 atom → 闪电进 P0 判定区', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: [] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
      ],
      cardMap: { [sd.id]: sd },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].pendingTricks).toHaveLength(0);

    await applyAtom(state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '闪电', source: 0, card: sd },
    });

    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('闪电');
    expect(harness.state.players[0].pendingTricks[0].source).toBe(0);
    expect(harness.state.players[0].pendingTricks[0].card).toEqual(sd);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:判定阶段触发 闪电 → 翻判定牌 ♥K(非♠2-9)→ 闪电不命中 → 传递给下家 P1
  //   走真实路径:阶段开始(判定)after-hook → resumeDelayedSettlement → resolveLightning
  // ─────────────────────────────────────────────────────────────
  it('用例2:判定 ♥K(非命中)→ 闪电传递给下家 P1,P0 不受伤', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const judgeCard: Card = makeCard('jd1', '杀', '♥', 'K', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          pendingTricks: [{ name: '闪电', source: 0, card: sd }],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
      ],
      cardMap: { [sd.id]: sd, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);

    // 触发判定阶段 → 闪电 hook:先问无懈(broadcast 超时无人出)→ 判定 ♥K → 非命中 → 传递下家
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 broadcast pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口(无人出无懈)

    // 判定牌从牌堆翻出后入弃牌堆
    expect(harness.state.zones.deck).not.toContain(judgeCard.id);
    expect(harness.state.zones.discardPile).toContain(judgeCard.id);
    expect(harness.state.zones.processing).not.toContain(judgeCard.id);

    // P0 判定区清空(闪电已传递走)
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);
    // P1 收到闪电(下家)
    expect(harness.state.players[1].pendingTricks).toHaveLength(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('闪电');
    // P0 未受伤(非命中)
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:判定阶段触发 闪电 → 翻判定牌 ♠5(命中♠2-9)→ P0 受 3 点雷电伤害 + 闪电移除
  //   走真实路径:阶段开始(判定)after-hook → resumeDelayedSettlement → resolveLightning
  // ─────────────────────────────────────────────────────────────
  it('用例3:判定 ♠5(命中)→ P0 受 3 点雷电伤害,闪电从判定区移除', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const judgeCard: Card = makeCard('jd1', '杀', '♠', '5', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 4,
          maxHealth: 4,
          pendingTricks: [{ name: '闪电', source: 0, card: sd }],
        }),
      ],
      cardMap: { [sd.id]: sd, [judgeCard.id]: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);

    // 触发判定阶段 → 闪电 hook:先问无懈(broadcast 超时无人出)→ 判定 ♠5 → 命中 → 3 点雷电伤害
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 broadcast pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口(无人出无懈)

    // 判定牌入弃牌堆
    expect(harness.state.zones.discardPile).toContain(judgeCard.id);
    // P0 受 3 点雷电伤害:4 → 1
    expect(harness.state.players[0].health).toBe(1);
    // 闪电从判定区移除
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);
  });
});
