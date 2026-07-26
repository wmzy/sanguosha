// tests/skill-tests/phase-between.test.ts
// 模块 J:阶段间时机 atom 验证(对齐 docs/flow-redesign.md 模块 J)。
//
// 验证点:
//   1. 阶段间 atom 在 阶段结束 与 阶段开始(next) 之间发出
//   2. 阶段间 atom 的 from/to 正确(准备→判定、判定→摸牌、摸牌→出牌、出牌→弃牌、弃牌→回合结束)
//   3. 阶段间 before-hook cancel → 跳过下一阶段(不 apply 阶段开始(next))
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Atom, GameState, PlayerState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { registerBeforeHook } from '../../src/engine/skill';
import { SkillTestHarness } from '../engine-harness';

// ─── 直测辅助:最小 2 人 state ───────────────────────────────

function makePlayer(opts: {
  index: number;
  name: string;
  health?: number;
  maxHealth?: number;
  hand?: string[];
  skills?: string[];
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
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

/** 构建初始 state:player0 有 回合管理(驱动阶段推进)。
 *  startPhase 决定初始阶段(默认 准备)。
 *  P0 手牌 5 张 > 体力 4:出牌→弃牌 级联时弃牌阶段产生 discard pending 阻塞
 *  (弃牌完成后才自动推进到回合结束),便于在弃牌阶段断言中间状态。 */
function makeState(startPhase: '准备' | '判定' | '摸牌' | '出牌' | '弃牌' = '准备'): GameState {
  const handCards = ['m1', 'm2', 'm3', 'm4', 'm5'];
  const cardMap: GameState['cardMap'] = {};
  for (const id of handCards) {
    cardMap[id] = { id, name: '杀', suit: '♠', color: '黑', rank: '5', type: '基本牌' };
  }
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P0', skills: ['回合管理'], hand: handCards }),
      makePlayer({ index: 1, name: 'P1' }),
    ],
    cardMap,
    currentPlayerIndex: 0,
    phase: startPhase,
    turn: { round: 1, phase: startPhase, vars: {} },
  });
}

/** 取 state.atomHistory 中所有 atom 事件的 type 序列。 */
function atomTypes(state: GameState): string[] {
  return state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom.type);
}

/** 取 state.atomHistory 中所有 atom(含完整数据)。 */
function allAtoms(state: GameState): Atom[] {
  return state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom);
}

/** 取所有 阶段间 atom。 */
function betweenAtoms(state: GameState): Extract<Atom, { type: '阶段间' }>[] {
  return allAtoms(state).filter(
    (a): a is Extract<Atom, { type: '阶段间' }> => a.type === '阶段间',
  );
}

// ─── 1. 阶段间 在 阶段结束 与 阶段开始 之间发出 ──────────────

describe('模块 J:阶段间 atom 在 阶段结束 与 阶段开始 之间发出', () => {
  it('阶段结束(出牌) → 阶段间(出牌→弃牌) → 阶段开始(弃牌)', async () => {
    const harness = new SkillTestHarness();
    const state = makeState('出牌');
    await harness.setup(state);

    // 清空已注册事件,只观察本次推进
    state.atomHistory.length = 0;

    void applyAtom(state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();

    const types = atomTypes(state);
    const idxEnd = types.indexOf('阶段结束');
    const idxBetween = types.indexOf('阶段间');
    const idxStart = types.indexOf('阶段开始');

    // 三者都存在,且顺序: 阶段结束 < 阶段间 < 阶段开始
    expect(idxBetween).toBeGreaterThan(-1);
    expect(idxEnd).toBeLessThan(idxBetween);
    expect(idxBetween).toBeLessThan(idxStart);

    // 阶段间 的 from/to 正确
    const bt = betweenAtoms(state)[0];
    expect(bt.from).toBe('出牌');
    expect(bt.to).toBe('弃牌');
    expect(bt.player).toBe(0);

    // 推进后 phase = 弃牌
    expect(state.phase).toBe('弃牌');
  });

  it('阶段结束(弃牌) → 阶段间(弃牌→回合结束) → 阶段开始(回合结束)', async () => {
    const harness = new SkillTestHarness();
    const state = makeState('弃牌');
    await harness.setup(state);

    state.atomHistory.length = 0;

    void applyAtom(state, { type: '阶段结束', player: 0, phase: '弃牌' });
    await harness.waitForStable();
    harness.processAllEvents();

    const types = atomTypes(state);
    const idxEnd = types.indexOf('阶段结束');
    const idxBetween = types.indexOf('阶段间');
    const idxStart = types.indexOf('阶段开始');

    expect(idxBetween).toBeGreaterThan(-1);
    expect(idxEnd).toBeLessThan(idxBetween);
    expect(idxBetween).toBeLessThan(idxStart);

    const bt = betweenAtoms(state)[0];
    expect(bt.from).toBe('弃牌');
    expect(bt.to).toBe('回合结束');
    expect(bt.player).toBe(0);

    expect(state.phase).toBe('回合结束');
  });
});

// ─── 2. 全链 from/to 正确(准备→判定→摸牌→出牌→弃牌→回合结束) ──

describe('模块 J:全链阶段间 from/to 正确', () => {
  it('从 准备 级联触发:阶段间(准备→判定)、(判定→摸牌)、(摸牌→出牌)', async () => {
    const harness = new SkillTestHarness();
    const state = makeState('准备');
    await harness.setup(state);

    state.atomHistory.length = 0;

    // 触发准备阶段结束 → 回合管理 after-hook 级联推进到出牌阶段
    void applyAtom(state, { type: '阶段结束', player: 0, phase: '准备' });
    await harness.waitForStable();
    harness.processAllEvents();

    const bts = betweenAtoms(state);
    // 应产生 3 个 阶段间 atom(准备→判定, 判定→摸牌, 摸牌→出牌)
    expect(bts).toHaveLength(3);
    expect(bts.map((b) => `${b.from}→${b.to}`)).toEqual([
      '准备→判定',
      '判定→摸牌',
      '摸牌→出牌',
    ]);
    // 全部属于 player 0
    expect(bts.every((b) => b.player === 0)).toBe(true);

    // 级联停在出牌阶段
    expect(state.phase).toBe('出牌');
  });

  it('出牌→弃牌:阶段结束(出牌) 发 阶段间(出牌→弃牌)', async () => {
    const harness = new SkillTestHarness();
    const state = makeState('出牌');
    await harness.setup(state);
    state.atomHistory.length = 0;

    void applyAtom(state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();

    const bts = betweenAtoms(state);
    expect(bts).toHaveLength(1);
    expect(bts[0].from).toBe('出牌');
    expect(bts[0].to).toBe('弃牌');
  });

  it('弃牌→回合结束:阶段结束(弃牌) 发 阶段间(弃牌→回合结束)', async () => {
    const harness = new SkillTestHarness();
    const state = makeState('弃牌');
    await harness.setup(state);
    state.atomHistory.length = 0;

    void applyAtom(state, { type: '阶段结束', player: 0, phase: '弃牌' });
    await harness.waitForStable();
    harness.processAllEvents();

    const bts = betweenAtoms(state);
    expect(bts).toHaveLength(1);
    expect(bts[0].from).toBe('弃牌');
    expect(bts[0].to).toBe('回合结束');
  });
});

// ─── 3. cancel 语义:阶段间 before-hook cancel → 跳过下一阶段 ──

describe('模块 J:阶段间 before-hook cancel → 跳过下一阶段', () => {
  it('cancel 阶段间(准备→判定) → 不 apply 阶段开始(判定),phase 不变', async () => {
    const harness = new SkillTestHarness();
    const state = makeState('准备');
    await harness.setup(state);

    // 注册一个 cancel 阶段间 的 before-hook(模拟神速①/放权/克己 等未来跳阶段技能)
    registerBeforeHook(state, 'mockSkipPhase', 1, '阶段间', async () => {
      return { kind: 'cancel' as const };
    });

    state.atomHistory.length = 0;

    void applyAtom(state, { type: '阶段结束', player: 0, phase: '准备' });
    await harness.waitForStable();
    harness.processAllEvents();

    const types = atomTypes(state);

    // 阶段间 被 cancel → 不入 atomHistory(只发 atomCancelled notify)
    expect(types).not.toContain('阶段间');
    // 阶段开始(判定) 未被 apply
    const phaseStarts = allAtoms(state).filter(
      (a) => a.type === '阶段开始',
    ) as Extract<Atom, { type: '阶段开始' }>[];
    expect(phaseStarts.find((a) => a.phase === '判定')).toBeUndefined();
    // phase 未推进到 判定(仍停留在 准备——级联被 cancel 阻断)
    expect(state.phase).not.toBe('判定');
  });

  it('无 before-hook 时 阶段间 正常 apply(不阻塞)', async () => {
    const harness = new SkillTestHarness();
    const state = makeState('出牌');
    await harness.setup(state);
    state.atomHistory.length = 0;

    void applyAtom(state, { type: '阶段结束', player: 0, phase: '出牌' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无 hook 时 阶段间 正常 apply,推进不受阻
    expect(state.phase).toBe('弃牌');
    const bts = betweenAtoms(state);
    expect(bts).toHaveLength(1);
  });
});
