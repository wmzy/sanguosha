// tests/integration/闪电判定.test.ts
// 集成测试:闪电(延时锦囊)判定
//
// 注:闪电 skill 模块尚未实现,所以真实的"判定黑桃2-9则造成3点伤害"逻辑
// 只能等到 skill 实现后才能测。当前覆盖:
//   1. 闪电卡通过 添加延时锦囊 atom 进入/离开判定区
//   2. 闪电与其他延时锦囊(乐不思蜀)并存 → 各自按 name 独立移除
//   3. 判定 atom (judgeType='闪电') 通用行为:翻判定牌→after hooks→进弃牌堆
//      (无 闪电 skill 时 after hook 不消耗闪电,验证 plumbing 通路)
//   4. 重复添加去重、重新装备、validate 校验
import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest, registerSkillsFromState, applyAtom } from '../../src/engine/create-engine';
import { SkillTestHarness } from '../engine-harness';
import { getAtomDef } from '../../src/engine/atom';
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
  // 用例 4:判定 atom (judgeType='闪电') → 翻判定牌进处理区,after hooks 不消耗延时锦囊
  // (因为当前无 闪电 skill 监听该 after hook,所以原子层 plumbing 验证)
  // ─────────────────────────────────────────────────────────────
  it('用例4:判定 atom 翻判定牌到处理区 → after hooks 收尾入弃;闪电仍在判定区(无 skill)', async () => {
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
    await applyAtom(harness.state, { type: '判定', player: 0, judgeType: '闪电' });

    // 判定牌已被翻到处理区后转入弃牌堆(atom 的 afterHooks 收尾)
    expect(harness.state.zones.deck).not.toContain(judgeCard.id);
    expect(harness.state.zones.processing).not.toContain(judgeCard.id);
    expect(harness.state.zones.discardPile).toContain(judgeCard.id);

    // 闪电仍在判定区(无 skill 处理 → 不移除)
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
    await applyAtom(harness.state, { type: '判定', player: 0, judgeType: '闪电' });
    expect(harness.state.zones.discardPile).toContain(jd1.id);
    expect(harness.state.zones.processing).not.toContain(jd1.id);

    // 第二张判定牌:用于 乐不思蜀
    await applyAtom(harness.state, { type: '判定', player: 0, judgeType: '乐不思蜀' });
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
  // 用例 2:判定 atom 翻判定牌(♠5)→ 处理区 → after hooks 收尾入弃
  //   无 闪电 skill 时,闪电仍保留在判定区(没有 skill 处理)
  // ─────────────────────────────────────────────────────────────
  it('用例2:判定 atom 翻判定牌(♠5)到处理区 → after hooks 收尾入弃;闪电仍在判定区(无 skill)', async () => {
    const sd: Card = makeCard('sd1', '闪电', '♠', 'A');
    const judgeCard: Card = makeCard('jd1', '杀', '♠', '5', '基本牌');

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
    await applyAtom(state, { type: '判定', player: 0, judgeType: '闪电' });

    // 判定牌已从牌堆翻到处理区,after hooks 收尾后入弃
    expect(harness.state.zones.deck).not.toContain(judgeCard.id);
    expect(harness.state.zones.discardPile).toContain(judgeCard.id);
    expect(harness.state.zones.processing).not.toContain(judgeCard.id);

    // 关键:无 闪电 skill 时,判定牌 ♠5 应触发 3 点伤害,
    //   但当前 skill 未实现 → 闪电仍保留在判定区(无 skill 处理)
    expect(harness.state.players[0].pendingTricks).toHaveLength(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('闪电');
    // 玩家血量未被伤害(因为无 闪电 skill)
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:[BUG 标注]期望:判定 ♠2-9 触发 3 点雷电伤害
  //   当前引擎未实现 闪电 skill,跳过断言
  // ─────────────────────────────────────────────────────────────
  it.skip('BUG:判定 ♠5 → 期望对 P0 造成 3 点雷电伤害(闪电 skill 未实现,跳过)', async () => {
    // BUG: 闪电 skill 模块未在 src/engine/skills/index.ts 注册(无 闪电.ts 文件)。
    // 预期: 判定阶段翻判定牌 → 若为 ♠2-9 → 对 P0 造成 3 点雷电伤害(无防具/技能挡)
    // 当前: 判定 atom 走完,但无 after hook 监听 判定/闪电 来 apply 伤害
    // 修复: 新增 src/engine/skills/闪电.ts,实现判定后花色检测 + 伤害应用,
    //      在 index.ts skillLoaders 注册;延后再写 判定/闪电 after hook。
    //
    // 本测试为占位:待 闪电 skill 实现后,移除 .skip 并补充完整断言。
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

    await applyAtom(state, { type: '判定', player: 0, judgeType: '闪电' });

    // 期望: 判定 ♠5 → 闪电触发 → P0 扣 3 血(4 → 1)
    expect(harness.state.players[0].health).toBe(1);
    // 闪电应从判定区移除
    expect(harness.state.players[0].pendingTricks).toHaveLength(0);
  });
});
