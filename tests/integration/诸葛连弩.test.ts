// tests/integration/诸葛连弩.test.ts
// 集成测试:诸葛连弩(武器,范围 1)——出牌阶段使用【杀】无次数限制
//
// 覆盖:
//   1. 装备诸葛连弩后,slashMax = Infinity(上限提供者注册)
//   2. slashMax=Infinity 时:同回合可以连续出多张杀(至少 3 张,验证 usedCount 不会触顶)
//   3. 卸下诸葛连弩后,slashMax 回到默认 1(出过一次杀则 usedCount=1,第二次被拒)
//
// 关键机制(诸葛连弩.ts):
//   onInit 注册上限提供者返回 Infinity → slashMax = ∞
//   杀.ts canSlash 读 slashUsed/slashMax(默认 1),Inf - usedCount = Inf(永远够用)。
//   装备卸下(卸载函数)反注册上限提供者,slashMax 回落基础 1。
//
// 模式:createGameState + registerSkillsFromState → dispatch 走真实 action 路径
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import { slashMax, slashUsed } from '../../src/engine/slash-quota';
import { dispatchAndWait, fireTimeoutAndWait, SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
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
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = '7', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌', subtype?: string, range?: number): Card {
  return { id, name, suit, rank, type, subtype, range };
}

describe('诸葛连弩:连续出杀 slashMax=Infinity', () => {
  beforeEach(() => {
    resetForTest();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:装备诸葛连弩 → 上限提供者注册 → slashMax = Infinity
  // ─────────────────────────────────────────────────────────────
  it('用例1:装备诸葛连弩后,onInit 注册上限提供者使 slashMax = Infinity', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [zhuge.id], equipment: {}, skills: ['杀', '装备通用'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [zhuge.id]: zhuge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装备前:slashMax 默认 1(无上限提供者)
    expect(slashMax(state, 0)).toBe(1);

    // 装备诸葛连弩 → 系统规则 添加技能 after hook 实例化 诸葛连弩 skill
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: zhuge.id },
      baseSeq: state.seq,
    });
    expect(state.players[0].equipment['武器']).toBe(zhuge.id);

    // 装备即注册上限提供者(无需再触发 阶段开始)
    expect(slashMax(state, 0)).toBe(Infinity);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:slashMax=Infinity → 连续出 3 张杀都不被 validate 拒绝
  // ─────────────────────────────────────────────────────────────
  it('用例2:装备诸葛连弩后,同回合连续出 3 张杀(P1 扣 3 血)', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);
    const slash1: Card = makeCard('k1', '杀', '♠', '7');
    const slash2: Card = makeCard('k2', '杀', '♠', '8');
    const slash3: Card = makeCard('k3', '杀', '♠', '9');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, slash1.id, slash2.id, slash3.id],
          equipment: {},
          skills: ['杀', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'], health: 4 }),
      ],
      cardMap: { [zhuge.id]: zhuge, [slash1.id]: slash1, [slash2.id]: slash2, [slash3.id]: slash3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装备诸葛连弩 → 上限提供者注册(无需 阶段开始)
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: zhuge.id },
      baseSeq: state.seq,
    });
    expect(slashMax(state, 0)).toBe(Infinity);

    const healthBefore = state.players[1].health;

    // 第一次出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash1.id, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    // P1 不出闪 → 扣血
    await fireTimeoutAndWait(state);
    expect(state.players[1].health).toBe(healthBefore - 1);
    // usedCount=1,上限仍 ∞ → 可继续出
    expect(slashUsed(state)).toBe(1);

    // 第二次出杀:应被允许(slashMax=Infinity,默认 1 时第二次会被拒)
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash2.id, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    await fireTimeoutAndWait(state);
    expect(state.players[1].health).toBe(healthBefore - 2);
    expect(slashUsed(state)).toBe(2);

    // 第三次出杀:也应被允许(上限始终 Infinity)
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash3.id, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    await fireTimeoutAndWait(state);
    expect(state.players[1].health).toBe(healthBefore - 3);

    // 三张杀都进弃牌堆
    expect(state.zones.discardPile).toContain(slash1.id);
    expect(state.zones.discardPile).toContain(slash2.id);
    expect(state.zones.discardPile).toContain(slash3.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:对比:无诸葛连弩时第二次出杀被 validate 拒绝
  // ─────────────────────────────────────────────────────────────
  it('用例3:回归——无诸葛连弩时,出完一张杀后 usedCount=1,第二次出杀被拒绝', async () => {
    const slash1: Card = makeCard('k1', '杀', '♠', '7');
    const slash2: Card = makeCard('k2', '杀', '♠', '8');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [slash1.id, slash2.id],
          equipment: {},
          skills: ['杀'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'], health: 4 }),
      ],
      cardMap: { [slash1.id]: slash1, [slash2.id]: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 默认 slashMax=1,usedCount=0(未出过杀)
    expect(slashMax(state, 0)).toBe(1);
    expect(slashUsed(state)).toBe(0);

    // 第一次出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash1.id, targets: [1] },
      baseSeq: state.seq,
    });
    await fireTimeoutAndWait(state);

    // usedCount=1(默认上限 1 → 已用满)
    expect(slashUsed(state)).toBe(1);

    // 第二次出杀应被 validate 拒绝
    const seqBefore = state.seq;
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash2.id, targets: [1] },
      baseSeq: state.seq,
    });
    // 拒绝时 state.seq 不变
    expect(state.seq).toBe(seqBefore);
    // 杀2 仍在手牌
    expect(state.players[0].hand).toContain(slash2.id);
    // P1 血量不变(只挨了一次杀)
    expect(state.players[1].health).toBe(3);
  });
});

// ── 以下为从 zhuge-crossbow.test.ts 合并的 SkillTestHarness 路径测试 ──

describe('诸葛连弩:上限提供者(∞) + 连续出杀 + 卸载', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:装备诸葛连弩 → 注册上限提供者(∞) → 连续出 2 张杀
  // ─────────────────────────────────────────────────────────────
  it('用例1:装备诸葛连弩后,上限 = ∞,同回合连续出 2 张杀(P1 扣 2 血)', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);
    const slash1: Card = makeCard('k1', '杀', '♠', '7');
    const slash2: Card = makeCard('k2', '杀', '♣', '8');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, slash1.id, slash2.id],
          skills: ['杀', '装备通用', '诸葛连弩'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'], health: 4 }),
      ],
      cardMap: { [zhuge.id]: zhuge, [slash1.id]: slash1, [slash2.id]: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const healthBefore = harness.state.players[1].health;

    // 装诸葛连弩 → onInit 注册上限提供者(∞) → slashMax = ∞
    await P0.useCard('装备通用', zhuge.id);
    expect(harness.state.players[0].equipment['武器']).toBe(zhuge.id);
    expect(slashMax(harness.state, 0)).toBe(Infinity);
    expect(harness.state.players[0].skills).toContain('诸葛连弩');

    // 第一张杀(usedCount 0 → 1;上限 ∞ → 可出)
    await P0.useCardAndTarget('杀', slash1.id, [1]);
    await P1.pass();
    expect(harness.state.players[1].health).toBe(healthBefore - 1);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);

    // 第二张杀:usedCount(1) < ∞ → 仍可出
    await P0.useCardAndTarget('杀', slash2.id, [1]);
    await P1.pass();
    expect(harness.state.players[1].health).toBe(healthBefore - 2);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(2);

    // 两张杀都进弃牌堆
    expect(harness.state.zones.discardPile).toContain(slash1.id);
    expect(harness.state.zones.discardPile).toContain(slash2.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:卸载(替换)诸葛连弩 → 诸葛连弩 skill 实例从 players.skills 移除
  // ─────────────────────────────────────────────────────────────
  it('用例2:换装成青釭剑 → 诸葛连弩 skill 被卸载', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);
    const sword: Card = makeCard('wp-qg', '青釭剑', '♠', '6', '装备牌', '武器', 2);

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, sword.id],
          skills: ['杀', '装备通用', '诸葛连弩', '青釭剑'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [zhuge.id]: zhuge, [sword.id]: sword },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');

    // 装诸葛连弩
    await P0.useCard('装备通用', zhuge.id);
    expect(harness.state.players[0].equipment['武器']).toBe(zhuge.id);
    expect(harness.state.players[0].skills).toContain('诸葛连弩');
    expect(slashMax(harness.state, 0)).toBe(Infinity);

    // 换装成青釭剑 → 诸葛连弩 skill 被卸载,旧装备进弃牌堆
    await P0.useCard('装备通用', sword.id);
    expect(harness.state.players[0].equipment['武器']).toBe(sword.id);
    expect(harness.state.players[0].skills).not.toContain('诸葛连弩');
    expect(harness.state.players[0].skills).toContain('青釭剑');
    expect(harness.state.zones.discardPile).toContain(zhuge.id);

    // 卸载函数取消注册上限提供者 → slashMax 回到 1;usedCount 保留(未出过杀仍为 undefined/0)
    expect(slashMax(harness.state, 0)).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:装连弩期间出过杀 → 换装后 usedCount 保留 → 不能再出杀
  //   新模型(分离 usedCount 与上限来源)的核心正确性保证:
  //   旧 杀/quota 方案下换装重置 quota 会丢失"已出过杀"信息;
  //   新方案 usedCount 不受装备增删影响 → 正确拒绝。
  // ─────────────────────────────────────────────────────────────
  it('装连弩期间出过 1 杀 → 换青釭剑后第二张杀被拒(usedCount 保留)', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);
    const sword: Card = makeCard('wp-qg', '青釭剑', '♠', '6', '装备牌', '武器', 2);
    const slash1: Card = makeCard('k1', '杀', '♠', '7');
    const slash2: Card = makeCard('k2', '杀', '♣', '8');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, sword.id, slash1.id, slash2.id],
          skills: ['杀', '装备通用', '诸葛连弩', '青釭剑'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'], health: 4 }),
      ],
      cardMap: { [zhuge.id]: zhuge, [sword.id]: sword, [slash1.id]: slash1, [slash2.id]: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const healthBefore = harness.state.players[1].health;

    // 装诸葛连弩 → 注册上限提供者 → 上限 ∞
    await P0.useCard('装备通用', zhuge.id);
    expect(slashMax(harness.state, 0)).toBe(Infinity);

    // 第一张杀:上限 ∞ → 成功(usedCount 0 → 1)
    await P0.useCardAndTarget('杀', slash1.id, [1]);
    await P1.pass();
    expect(harness.state.players[1].health).toBe(healthBefore - 1);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);

    // 换装青釭剑 → 卸载上限提供者 → 上限回到 1;usedCount 仍为 1
    await P0.useCard('装备通用', sword.id);
    expect(slashMax(harness.state, 0)).toBe(1);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);

    // 第二张杀:usedCount(1) >= 上限(1) → 被拒(关键修复点)
    await P0.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: slash2.id, targets: [1] } });
  });
});
