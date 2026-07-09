// @vitest-environment jsdom
// tests/client/useHandReorder.test.tsx
// useHandReorder hook 行为测试:验证手牌拖拽重排的本地预览、与服务端的同步/失效,
// 以及去抖发送 reorder_hand。
//
// 放置说明:useHandReorder 是纯手牌顺序管理 hook(非 skill、非 integration),原无对应测试,
// 故新建 tests/client/useHandReorder.test.tsx。聚焦分支覆盖:本地顺序合法性校验、
// 服务端同步/失效清除、拖拽重排、去抖发送、快速拖拽取消上次定时器。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHandReorder } from '../../src/client/hooks/useHandReorder';
import type { Card } from '../../src/engine/types';

// ─── 测试夹具 ───

function makeCard(id: string, name = '杀'): Card {
  return {
    id,
    name,
    suit: '♠',
    color: '黑',
    rank: '7',
    type: '基本牌',
    subtype: '杀',
  };
}

/** 以 id 数组构造手牌(顺序即服务端顺序)。 */
function hand(...ids: string[]): Card[] {
  return ids.map((id) => makeCard(id));
}

/** 取 orderedHand 的 id 序列,便于断言顺序。 */
function idsOf(cards: Card[]): string[] {
  return cards.map((c) => c.id);
}

describe('useHandReorder · orderedHand 派生(本地顺序 vs 服务端顺序)', () => {
  it('无拖拽时 orderedHand 沿用服务端顺序', () => {
    const { result } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b', 'c') },
    });
    expect(idsOf(result.current.orderedHand)).toEqual(['a', 'b', 'c']);
  });
});

describe('useHandReorder · 拖拽重排(handleDragStart/handleDrop)', () => {
  it('drop 到不同位置时按本地重排顺序预览', () => {
    const { result } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b', 'c') },
    });

    // 把 c(idx 2)拖到 idx 0
    act(() => result.current.handleDragStart(2));
    act(() => result.current.handleDrop(0));

    expect(idsOf(result.current.orderedHand)).toEqual(['c', 'a', 'b']);
  });

  it('drop 目标 === 源位置时不重排(原地释放)', () => {
    const { result } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b', 'c') },
    });
    act(() => result.current.handleDragStart(1));
    act(() => result.current.handleDrop(1));
    expect(idsOf(result.current.orderedHand)).toEqual(['a', 'b', 'c']);
  });

  it('未先 dragStart(dragSrcIdx=null)直接 drop 不重排', () => {
    const { result } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b', 'c') },
    });
    act(() => result.current.handleDrop(0));
    expect(idsOf(result.current.orderedHand)).toEqual(['a', 'b', 'c']);
  });

  it('基于当前 orderedHand 重排(连续拖拽累积预览)', () => {
    const { result } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b', 'c', 'd') },
    });
    // a→idx2 : [b,c,a,d]
    act(() => result.current.handleDragStart(0));
    act(() => result.current.handleDrop(2));
    expect(idsOf(result.current.orderedHand)).toEqual(['b', 'c', 'a', 'd']);
    // d→idx1 : [b,d,c,a]
    act(() => result.current.handleDragStart(3));
    act(() => result.current.handleDrop(1));
    expect(idsOf(result.current.orderedHand)).toEqual(['b', 'd', 'c', 'a']);
  });
});

describe('useHandReorder · 去抖发送 reorder_hand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drop 后 400ms 去抖发送重排后的 id 序列', () => {
    const onReorderHand = vi.fn();
    const { result } = renderHook(({ h }) => useHandReorder(h, onReorderHand), {
      initialProps: { h: hand('a', 'b', 'c') },
    });
    act(() => result.current.handleDragStart(2));
    act(() => result.current.handleDrop(0));
    // 未到时间不发送
    expect(onReorderHand).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onReorderHand).toHaveBeenCalledTimes(1);
    expect(onReorderHand).toHaveBeenCalledWith(['c', 'a', 'b']);
  });

  it('未到 400ms 时再次拖拽取消上次定时器,只发最后一次顺序', () => {
    const onReorderHand = vi.fn();
    const { result } = renderHook(({ h }) => useHandReorder(h, onReorderHand), {
      initialProps: { h: hand('a', 'b', 'c', 'd') },
    });
    // 第一次拖拽
    act(() => result.current.handleDragStart(0));
    act(() => result.current.handleDrop(3)); // [b,c,d,a]
    act(() => {
      vi.advanceTimersByTime(200); // 只过 200ms
    });
    // 第二次拖拽(应取消上次)
    act(() => result.current.handleDragStart(0));
    act(() => result.current.handleDrop(1)); // [c,b,d,a]
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onReorderHand).toHaveBeenCalledTimes(1);
    expect(onReorderHand).toHaveBeenCalledWith(['c', 'b', 'd', 'a']);
  });

  it('onReorderHand 未提供时 drop 不报错', () => {
    const { result } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b') },
    });
    expect(() => {
      act(() => result.current.handleDragStart(0));
      act(() => result.current.handleDrop(1));
    }).not.toThrow();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(idsOf(result.current.orderedHand)).toEqual(['b', 'a']);
  });
});

describe('useHandReorder · 服务端手牌变化后的同步与失效', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('服务端顺序已与本地重排一致(被服务端采纳)时清除本地状态', () => {
    const { result, rerender } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b', 'c') },
    });
    // 本地重排为 [c,a,b]
    act(() => result.current.handleDragStart(2));
    act(() => result.current.handleDrop(0));
    expect(idsOf(result.current.orderedHand)).toEqual(['c', 'a', 'b']);
    // 服务端采纳了同一顺序 → 本地状态清除
    rerender({ h: hand('c', 'a', 'b') });
    expect(idsOf(result.current.orderedHand)).toEqual(['c', 'a', 'b']);
    // 再此之后若服务端改成别的顺序,本地已不再覆盖(验证本地状态已清除)
    rerender({ h: hand('a', 'c', 'b') });
    expect(idsOf(result.current.orderedHand)).toEqual(['a', 'c', 'b']);
  });

  it('服务端手牌集合变化(出/弃牌)使本地顺序不再合法时,回退服务端顺序', () => {
    const { result, rerender } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b', 'c') },
    });
    act(() => result.current.handleDragStart(2));
    act(() => result.current.handleDrop(0));
    expect(idsOf(result.current.orderedHand)).toEqual(['c', 'a', 'b']);
    // 出了一张 a,手牌集合变 [b,c] → 本地顺序引用了已不存在的 a,失效
    rerender({ h: hand('b', 'c') });
    expect(idsOf(result.current.orderedHand)).toEqual(['b', 'c']);
  });

  it('服务端手牌长度变化(摸牌)使本地顺序不再合法时,回退服务端顺序', () => {
    const { result, rerender } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b', 'c') },
    });
    act(() => result.current.handleDragStart(2));
    act(() => result.current.handleDrop(0));
    // 摸了一张 d → 长度不匹配,本地失效
    rerender({ h: hand('a', 'b', 'c', 'd') });
    expect(idsOf(result.current.orderedHand)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('本地顺序含服务端没有的 id 时视为非法,回退服务端顺序', () => {
    const { result, rerender } = renderHook(({ h }) => useHandReorder(h), {
      initialProps: { h: hand('a', 'b', 'c') },
    });
    act(() => result.current.handleDragStart(2));
    act(() => result.current.handleDrop(0));
    // 服务端换了一批完全不同的牌
    rerender({ h: hand('x', 'y', 'z') });
    expect(idsOf(result.current.orderedHand)).toEqual(['x', 'y', 'z']);
  });
});
