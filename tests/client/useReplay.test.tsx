// @vitest-environment jsdom
// tests/client/useReplay.test.tsx
// useReplay hook 行为测试:验证回放节奏对齐实时游戏——
// 自动播放按「下一个 event 的 effect.duration / speed」推进(非固定间隔),
// 每步同步暴露 currentEvent(供 EventBanner/ActionOverlay)与 ingestedEvents(供 PlayHistoryStrip)。
//
// 放置说明:useReplay 是回放专属 hook(非 skill、非 integration),原无对应测试。
// 沿用 tests/client/useXxx.test.tsx 惯例新建,聚焦本次「事件队列对齐」改造的契约:
// duration 节奏、speed 倍率、手动/自动推进、导航跳转/切视角的事件同步语义。

// 节奏调度与事件同步是本次改造契约;view 重建(reducer 调 applyView)由
// tests/unit/replay-engine.test.ts 专门覆盖。这里 mock 掉 replayEngine 避开
// atom 注册表依赖,直接返回 initialView。
vi.mock('../../src/client/replay/replayEngine', () => ({
  getViewAt: (file: import('../../src/client/replay/types').ReplayFile, seat: number) =>
    file.seats[seat]?.initialView ?? null,
  totalSteps: (rec: { events?: unknown[] } | undefined) => rec?.events?.length ?? 0,
  availableSeats: (file: import('../../src/client/replay/types').ReplayFile) =>
    Object.keys(file.seats)
      .map(Number)
      .sort((a, b) => a - b),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReplay } from '../../src/client/hooks/useReplay';
import type { ReplayFile, SeatRecording } from '../../src/client/replay/types';
import type { GameView, ViewEvent } from '../../src/engine/types';

// ─── 测试夹具 ───

function makeView(): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: '刘备',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
      {
        index: 1,
        name: '曹操',
        character: '曹操',
        health: 4,
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

/** 构造带自定义 effect.duration 的事件(绕过 atom 注册表,直接走 ViewEvent.effect) */
function makeEvent(type: string, duration: number): ViewEvent {
  return {
    type,
    atomType: type,
    // ViewEvent.effect 是前端约定的可选字段,useReplay/computeEventDuration 优先读它
    effect: { duration },
  } as unknown as ViewEvent;
}

function makeSeat(events: ViewEvent[], seatIndex = 0): SeatRecording {
  return {
    seatIndex,
    playerName: `P${seatIndex}`,
    initialView: makeView(),
    events: events.map((event, i) => ({ seq: i + 1, time: i * 100, event })),
  };
}

function makeReplay(seats: Record<number, SeatRecording>): ReplayFile {
  return {
    format: 'sanguosha-replay',
    version: 1,
    meta: { createdAt: 1000, playerCount: 2, characters: ['刘备', '曹操'] },
    seats,
  };
}

// ─── 测试 ───

describe('useReplay · 事件队列节奏(对齐 useEventPlayback)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('自动播放按下一个 event 的 duration 推进(非固定间隔)', () => {
    // 第一步 duration=2000,第二步 duration=500 —— 固定间隔会两者相同
    const file = makeReplay({
      0: makeSeat([makeEvent('A', 2000), makeEvent('B', 500)]),
    });
    const { result } = renderHook(() => useReplay(file));

    expect(result.current.step).toBe(0);
    expect(result.current.currentEvent).toBeNull();
    expect(result.current.ingestedEvents).toEqual([]);

    act(() => result.current.togglePlay());

    // 推进 1999ms:第一步还未到(< 2000)
    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.step).toBe(0);

    // 再推进 1ms(累计 2000ms):第一步触发,step=1,currentEvent=A
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.step).toBe(1);
    expect(result.current.currentEvent?.event.type).toBe('A');
    expect(result.current.ingestedEvents).toHaveLength(1);
    expect(result.current.ingestedEvents[0].event.type).toBe('A');

    // 第二步只需 500ms
    act(() => vi.advanceTimersByTime(499));
    expect(result.current.step).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.step).toBe(2);
    expect(result.current.currentEvent?.event.type).toBe('B');

    // 到末尾:playing 自动停止
    expect(result.current.playing).toBe(false);
  });

  it('speed 倍率缩放间隔(speed=2 时间隔减半)', () => {
    const file = makeReplay({
      0: makeSeat([makeEvent('A', 2000)]),
    });
    const { result } = renderHook(() => useReplay(file));
    act(() => result.current.setSpeed(2));
    act(() => result.current.togglePlay());

    // 2000 / 2 = 1000ms 即触发
    act(() => vi.advanceTimersByTime(999));
    expect(result.current.step).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.step).toBe(1);
  });

  it('duration 不足 400ms 时按下限 400/speed 兜底(与 useEventPlayback MIN_VISIBLE_MS 对齐)', () => {
    const file = makeReplay({
      0: makeSeat([makeEvent('A', 50)]),
    });
    const { result } = renderHook(() => useReplay(file));
    act(() => result.current.togglePlay());

    // 50ms 不够,需 400ms
    act(() => vi.advanceTimersByTime(399));
    expect(result.current.step).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.step).toBe(1);
  });

  it('手动 next 立即推进并同步 currentEvent/ingestedEvents', () => {
    const file = makeReplay({
      0: makeSeat([makeEvent('A', 9999), makeEvent('B', 9999)]),
    });
    const { result } = renderHook(() => useReplay(file));

    act(() => result.current.next());
    expect(result.current.step).toBe(1);
    expect(result.current.currentEvent?.event.type).toBe('A');
    expect(result.current.ingestedEvents.map((e) => e.event.type)).toEqual(['A']);

    act(() => result.current.next());
    expect(result.current.step).toBe(2);
    expect(result.current.currentEvent?.event.type).toBe('B');
    expect(result.current.ingestedEvents.map((e) => e.event.type)).toEqual(['B']);
  });

  it('prev 同步更新 currentEvent 但清空 ingestedEvents(避免反向污染历史条)', () => {
    const file = makeReplay({
      0: makeSeat([makeEvent('A', 1), makeEvent('B', 1)]),
    });
    const { result } = renderHook(() => useReplay(file));

    // 先前进到 step=2(B)
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.currentEvent?.event.type).toBe('B');

    // 回退一步:currentEvent 变回 A,但 ingestedEvents 清空
    act(() => result.current.prev());
    expect(result.current.step).toBe(1);
    expect(result.current.currentEvent?.event.type).toBe('A');
    expect(result.current.ingestedEvents).toEqual([]);
  });

  it('goTo 跳转清空 currentEvent/ingestedEvents(跳转不展示横幅)', () => {
    const file = makeReplay({
      0: makeSeat([makeEvent('A', 1), makeEvent('B', 1), makeEvent('C', 1)]),
    });
    const { result } = renderHook(() => useReplay(file));

    act(() => result.current.next());
    expect(result.current.currentEvent?.event.type).toBe('A');

    act(() => result.current.goTo(3));
    expect(result.current.step).toBe(3);
    expect(result.current.currentEvent).toBeNull();
    expect(result.current.ingestedEvents).toEqual([]);
    expect(result.current.playing).toBe(false);
  });

  it('setSeat 切视角清空 currentEvent/ingestedEvents', () => {
    const file = makeReplay({
      0: makeSeat([makeEvent('A0', 1)], 0),
      1: makeSeat([makeEvent('A1', 1)], 1),
    });
    const { result } = renderHook(() => useReplay(file));

    act(() => result.current.next());
    expect(result.current.currentEvent?.event.type).toBe('A0');

    act(() => result.current.setSeat(1));
    expect(result.current.seat).toBe(1);
    expect(result.current.currentEvent).toBeNull();
    expect(result.current.ingestedEvents).toEqual([]);
  });

  it('末尾 togglePlay 从头开始并清空节奏状态', () => {
    const file = makeReplay({
      0: makeSeat([makeEvent('A', 1)]),
    });
    const { result } = renderHook(() => useReplay(file));

    // 推进到末尾
    act(() => result.current.next());
    expect(result.current.step).toBe(1);
    expect(result.current.playing).toBe(false);

    // 末尾 togglePlay:重置 step=0,清空 currentEvent,开始播放
    act(() => result.current.togglePlay());
    expect(result.current.step).toBe(0);
    expect(result.current.currentEvent).toBeNull();
    expect(result.current.playing).toBe(true);

    // 推进一步:currentEvent=A
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.step).toBe(1);
    expect(result.current.currentEvent?.event.type).toBe('A');
  });
});
