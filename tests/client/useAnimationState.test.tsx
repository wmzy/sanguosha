// @vitest-environment jsdom
// tests/client/useAnimationState.test.tsx
// useAnimationState hook 行为测试:验证从 GameView 差分检测出的 UI 动画触发信号
// (摸牌、伤害、阶段变化、新回合),以及动画结束后的自动清除。
//
// 放置说明:useAnimationState 是纯动画状态派生 hook(非 skill、非 integration),原无对应测试,
// 故新建 tests/client/useAnimationState.test.tsx。聚焦分支覆盖:四类事件检测、
// 版本号递增、动画窗口定时清除、无变化不递增。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnimationState } from '../../src/client/hooks/useAnimationState';
import type { Card, GameView } from '../../src/engine/types';

// ─── 测试夹具 ───

function makeCard(id: string): Card {
  return {
    id,
    name: '杀',
    suit: '♠',
    color: '黑',
    rank: '7',
    type: '基本牌',
    subtype: '杀',
  };
}

/** 构造最小合法 GameView;handP0 控制视角(P0)的手牌,phase/round 控制阶段/回合。 */
function makeView(opts: {
  p0Hand?: string[];
  p0Hp?: number;
  p1Hp?: number;
  phase?: GameView['phase'];
  round?: number;
}): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: opts.phase ?? '出牌',
    turn: { round: opts.round ?? 1, phase: opts.phase ?? '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: 'P0',
        character: '孙权',
        health: opts.p0Hp ?? 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: opts.p0Hand?.length ?? 0,
        hand: (opts.p0Hand ?? []).map((id) => makeCard(id)),
        marks: [],
      },
      {
        index: 1,
        name: 'P1',
        character: 'X',
        health: opts.p1Hp ?? 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
    ],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

describe('useAnimationState · 伤害检测(damageFlashIndices)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('玩家 HP 下降时记录伤害座次并递增版本号', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ p0Hp: 4, p1Hp: 4 }) },
    });
    // P0 受伤 4→3
    rerender({ view: makeView({ p0Hp: 3, p1Hp: 4 }) });
    expect(result.current.damageFlashIndices.get(0)).toBe(1);
  });

  it('连续受伤版本号递增(不读旧 state 快照)', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ p0Hp: 4 }) },
    });
    rerender({ view: makeView({ p0Hp: 3 }) });
    expect(result.current.damageFlashIndices.get(0)).toBe(1);
    rerender({ view: makeView({ p0Hp: 2 }) });
    expect(result.current.damageFlashIndices.get(0)).toBe(2);
  });

  it('伤害动画窗口(650ms)结束后自动清除', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ p0Hp: 4 }) },
    });
    rerender({ view: makeView({ p0Hp: 3 }) });
    expect(result.current.damageFlashIndices.has(0)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(650);
    });
    expect(result.current.damageFlashIndices.has(0)).toBe(false);
  });

  it('HP 未下降时不记录伤害', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ p0Hp: 4 }) },
    });
    // 回血不算伤害
    rerender({ view: makeView({ p0Hp: 4 }) });
    expect(result.current.damageFlashIndices.size).toBe(0);
  });
});

describe('useAnimationState · 阶段变化检测(phaseVersion / discardPhase)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('阶段变化时 phaseVersion 递增', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ phase: '摸牌' }) },
    });
    expect(result.current.phaseVersion).toBe(0);
    rerender({ view: makeView({ phase: '出牌' }) });
    expect(result.current.phaseVersion).toBe(1);
  });

  it('进入弃牌阶段时 discardPhase=true', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ phase: '出牌' }) },
    });
    rerender({ view: makeView({ phase: '弃牌' }) });
    expect(result.current.discardPhase).toBe(true);
  });

  it('非弃牌阶段切换时 discardPhase 置 false 并在 400ms 后保持 false', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ phase: '弃牌' }) },
    });
    // 先进弃牌(discardPhase=true)
    expect(result.current.discardPhase).toBe(false); // 初始 prevPhase=弃牌,首次 effect 不触发
    // 切回出牌(非弃牌):discardPhase=false
    rerender({ view: makeView({ phase: '出牌' }) });
    expect(result.current.discardPhase).toBe(false);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.discardPhase).toBe(false);
  });

  it('进入弃牌阶段后保持 discardPhase=true(不触发 400ms 清除)', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ phase: '出牌' }) },
    });
    rerender({ view: makeView({ phase: '弃牌' }) });
    expect(result.current.discardPhase).toBe(true);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // 弃牌阶段不设 400ms 清除定时器,保持 true
    expect(result.current.discardPhase).toBe(true);
  });

  it('阶段未变化时 phaseVersion 不递增', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ phase: '出牌' }) },
    });
    rerender({ view: makeView({ phase: '出牌' }) });
    expect(result.current.phaseVersion).toBe(0);
  });
});

describe('useAnimationState · 新回合检测(turnVersion)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('回合数变化时 turnVersion 递增', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ round: 1 }) },
    });
    expect(result.current.turnVersion).toBe(0);
    rerender({ view: makeView({ round: 2 }) });
    expect(result.current.turnVersion).toBe(1);
  });

  it('回合数不变时 turnVersion 不递增', () => {
    const { result, rerender } = renderHook(({ view }) => useAnimationState(view, 0), {
      initialProps: { view: makeView({ round: 1 }) },
    });
    rerender({ view: makeView({ round: 1 }) });
    expect(result.current.turnVersion).toBe(0);
  });
});
