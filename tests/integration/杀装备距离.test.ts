// tests/integration/杀装备距离.test.ts
// 集成测试:杀 + 装备 + 距离核心链路
//
// 覆盖:
//   1. 装备武器后攻击范围扩大(inAttackRange)
//   2. 出杀 → 出闪 → 抵消伤害
//   3. 出杀 → 不出闪(超时) → 扣血
//   4. 诸葛连弩 → 无限出杀
//
// 模式:手写 GameState(createGameState) + registerSkillsFromState,
//       dispatch 走真实 action 路径(不动用 SkillTestHarness),
//       测的是新引擎 顶层 API + 距离/装备/杀的端到端协作。
import { describe, it, expect } from 'vitest';
import { registerSkillsFromState } from '../../src/engine/create-engine';
import { fireTimeoutAndWait, dispatchAndWait } from '../engine-harness';
import { inAttackRange } from '../../src/engine/distance';
import { slashMax } from '../../src/engine/slash-quota';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand: string[];
  skills: string[];
  health?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand,
    equipment: {},
    skills: opts.skills,
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('杀 + 装备 + 距离', () => {
  // ─────────────────────────────────────────────────────────────
  // 用例 1:装备武器后攻击范围扩大
  // ─────────────────────────────────────────────────────────────
  it('用例1:装备丈八蛇矛(范围 3)后,P0 可以攻击座位距离 2 的 P2', async () => {
    // 卡定义:丈八蛇矛(范围 3)
    const weapon: Card = {
      id: 'wp-zh',
      name: '丈八蛇矛',
      suit: '♠',
      color: '黑',
      rank: 'A',
      type: '装备牌',
      subtype: '武器',
      range: 3,
    };
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [weapon.id, slash.id],
          skills: ['杀', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: [] }),
        makePlayer({ index: 3, name: 'P3', hand: [], skills: [] }),
      ],
      cardMap: { [weapon.id]: weapon, [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装备前:徒手范围 1,P0 → P2 座位距离 2 > 1,打不到
    expect(inAttackRange(state, 0, 2)).toBe(false);

    // 装备丈八蛇矛
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: weapon.id },
      baseSeq: 0,
    });

    // 装备后:vars['距离/出杀范围'] 应被设为 3
    expect(state.players[0].vars['距离/出杀范围']).toBe(3);
    expect(state.players[0].equipment['武器']).toBe(weapon.id);
    expect(state.players[0].hand).not.toContain(weapon.id);

    // 装备后:P0 → P2 座位距离 2 ≤ 3,在攻击范围内
    expect(inAttackRange(state, 0, 2)).toBe(true);
    // P0 → P3 也是座位距离 2,同样可达
    expect(inAttackRange(state, 0, 3)).toBe(true);
    // 自己不能打自己
    expect(inAttackRange(state, 0, 0)).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:出杀 → 出闪 → 伤害为 0
  // ─────────────────────────────────────────────────────────────
  it('用例2:出杀 → P1 出闪 → P1 不扣血,杀和闪都进弃牌堆', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [dodge.id], skills: ['闪'] }),
      ],
      cardMap: { [slash.id]: slash, [dodge.id]: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const beforeHealth = state.players[1].health;

    // 第一步:P0 出杀 → 产生 询问闪 pending
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: 0,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    expect(state.players[1].health).toBe(beforeHealth); // 还没扣血

    // 第二步:P1 出闪回应
    await dispatchAndWait(state, {
      skillId: '闪',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: dodge.id },
      baseSeq: 0,
    });

    // 出闪后:P1 血量不变
    expect(state.players[1].health).toBe(beforeHealth);
    expect(state.players[1].alive).toBe(true);
    // 杀和闪都进弃牌堆
    expect(state.zones.discardPile).toContain(slash.id);
    expect(state.zones.discardPile).toContain(dodge.id);
    // 处理区已清空
    expect(state.zones.processing).not.toContain(slash.id);
    expect(state.zones.processing).not.toContain(dodge.id);
    // pending 已消费
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:出杀 → 不出闪 → 扣血
  // ─────────────────────────────────────────────────────────────
  it('用例3:出杀 → P1 不出闪(超时)→ P1 扣 1 血', async () => {
    const slash: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    const beforeHealth = state.players[1].health;

    // 第一步:P0 出杀 → 产生 询问闪 pending
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash.id, targets: [1] },
      baseSeq: 0,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    expect(state.players[1].health).toBe(beforeHealth);

    // 第二步:模拟超时(不出闪)→ 触发 onTimeout (无操作) → 杀结算伤害
    await fireTimeoutAndWait(state);

    // 伤害后:P1 扣 1 血
    expect(state.players[1].health).toBe(beforeHealth - 1);
    expect(state.players[1].alive).toBe(true);
    // 杀进弃牌堆
    expect(state.zones.discardPile).toContain(slash.id);
    // pending 已消费
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:诸葛连弩 → 无限出杀
  // ─────────────────────────────────────────────────────────────
  it('用例4:装备诸葛连弩后,同回合可以出多张杀', async () => {
    // 诸葛连弩卡(range=1,武器)
    const zhuge: Card = {
      id: 'wp-zg',
      name: '诸葛连弩',
      suit: '♣',
      color: '黑',
      rank: 'A',
      type: '装备牌',
      subtype: '武器',
      range: 1,
    };
    const slash1: Card = {
      id: 'k1',
      name: '杀',
      suit: '♠',
      color: '黑',
      rank: '7',
      type: '基本牌',
    };
    const slash2: Card = {
      id: 'k2',
      name: '杀',
      suit: '♠',
      color: '黑',
      rank: '8',
      type: '基本牌',
    };

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [zhuge.id, slash1.id, slash2.id],
          skills: ['杀', '装备通用'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [zhuge.id]: zhuge, [slash1.id]: slash1, [slash2.id]: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 装备诸葛连弩
    await dispatchAndWait(state, {
      skillId: '装备通用',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: zhuge.id },
      baseSeq: 0,
    });
    expect(state.players[0].equipment['武器']).toBe(zhuge.id);

    // 装诸葛连弩 → onInit 注册上限提供者 → slashMax = ∞
    // 新模型不依赖 阶段开始 hook:提供者在装备(添加技能)时注册
    expect(slashMax(state, 0)).toBe(Infinity);

    // 第一次出杀
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash1.id, targets: [1] },
      baseSeq: 1,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const healthAfterFirst = state.players[1].health;

    // 不出闪 → 扣血
    await fireTimeoutAndWait(state);
    expect(state.players[1].health).toBe(healthAfterFirst - 1);

    // usedCount 0 → 1(上限 ∞ → 可出)
    expect(state.turn.vars['杀/quotaUsed']).toBe(1);

    // 第二次出杀:应被允许(usedCount 1 < ∞)
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: slash2.id, targets: [1] },
      baseSeq: 2,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    // 第二次也不出闪 → 再扣血
    await fireTimeoutAndWait(state);
    expect(state.players[1].health).toBe(healthAfterFirst - 2);

    // 两张杀都进弃牌堆
    expect(state.zones.discardPile).toContain(slash1.id);
    expect(state.zones.discardPile).toContain(slash2.id);
  });
});

// ─────────────────────────────────────────────────────────────
// 回归测试:skill 注册表 state 隔离
//
// 背景:bug「孙权被询问是否发动流离」——-seat 0(孙权)被杀指定为目标后,
// 引擎错误弹出 流离/confirm 确认框。孙权没有流离技能,本局也无任何玩家有流离。
// 根因:afterHooks 是模块级全局 Map,跨对局泄漏 + ownerId 碰巧匹配 target 就错误触发。
// 修复:注册表搬到 state-bound(WeakMap 外挂),state 隔离 = 注册表隔离,泄漏物理不可能。
//
// 本测试验证:state A 注册了流离(ownerId=0),state B(独立)杀 seat 0 时不触发流离。
// 旧架构下 state A 的流离 hook 会泄漏到全局表,state B 的杀结算会错误触发。
// ─────────────────────────────────────────────────────────────
describe('skill 注册表 state 隔离(流离泄漏回归)', () => {
  it('state A 注册流离后,state B(无流离玩家)杀 seat 0 不触发 流离/confirm', async () => {
    const slash: Card = { id: 'c1', name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };

    // state A:seat 0 有流离技能(会注册流离 after hook 到 state A 的注册表)
    const stateA = createGameState({
      players: [
        {
          index: 0,
          name: '大乔',
          character: '大乔',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: ['流离', '闪', '装备通用'],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 1,
          name: 'P1',
          character: '',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [slash.id],
          equipment: {},
          skills: ['杀', '装备通用'],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
      ],
      cardMap: { c1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(stateA);

    // state B:5 人局(孙权/黄盖/夏侯渊/庞德/荀彧),无人有流离
    const slashB: Card = {
      id: 'c2',
      name: '杀',
      suit: '♥',
      color: '红',
      rank: '3',
      type: '基本牌',
    };
    const stateB = createGameState({
      players: [
        {
          index: 0,
          name: '孙权',
          character: '孙权',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: ['制衡', '闪', '装备通用'],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 1,
          name: '黄盖',
          character: '黄盖',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: ['苦肉', '装备通用'],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 2,
          name: '夏侯渊',
          character: '夏侯渊',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: ['神速', '装备通用'],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 3,
          name: '庞德',
          character: '庞德',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: ['马术', '装备通用'],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 4,
          name: '荀彧',
          character: '荀彧',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [slashB.id],
          equipment: {},
          skills: ['驱虎', '杀', '装备通用'],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
      ],
      cardMap: { c2: slashB },
      currentPlayerIndex: 4,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(stateB);

    // state B:seat 4 对 seat 0 出杀
    await dispatchAndWait(stateB, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 4,
      params: { cardId: slashB.id, targets: [0] },
      baseSeq: 0,
    });

    // 关键断言:不应出现 流离/confirm 的 pending
    const pendingAtoms = [...stateB.pendingSlots.values()].map(
      (s) => (s.atom as { requestType?: string }).requestType,
    );
    expect(pendingAtoms).not.toContain('流离/confirm');

    // 应该是正常的 询问闪 pending(杀结算的正常流程)
    const pendingTypes = [...stateB.pendingSlots.values()].map(
      (s) => (s.atom as { type: string }).type,
    );
    expect(pendingTypes.some((t) => t === '询问闪' || t === '请求回应')).toBe(true);
  });
});
