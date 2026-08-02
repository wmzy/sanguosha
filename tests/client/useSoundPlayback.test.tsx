// @vitest-environment jsdom
// tests/client/useSoundPlayback.test.tsx
// useSoundPlayback hook 行为测试:验证音效跟随 ingested 立即批次响应(与视觉动作同帧),
// 氛围音效(回合/阶段)fire-and-forget,动作音效串行(避免叠音)。
//
// 放置说明:useSoundPlayback 是音效播放 hook(非 skill、非 integration),原无对应测试。
// 按 AGENTS.md「仅以上都不适用时才新建文件」,音效播放层无现成归属,故新建此文件,
// 与 tests/client/ 下其它独立 hook 测试(useAnimationState/useReplay/…)同构。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import type { ViewEvent } from '../../src/engine/types';

// mock audioEngine:jsdom 无 AudioContext,且要断言 play 调用次数/参数。
// 同时 mock getDuration 返回固定时长,使串行间隔可预测。
const { playMock } = vi.hoisted(() => ({
  playMock: vi.fn(),
}));
const { getDurationMock } = vi.hoisted(() => ({
  getDurationMock: vi.fn(() => 0.3),
}));
vi.mock('../../src/client/sounds/audioEngine', () => ({
  audioEngine: { play: playMock, getDuration: getDurationMock },
}));

import { useSoundPlayback } from '../../src/client/hooks/useSoundPlayback';
import type { QueuedEvent } from '../../src/client/hooks/useEventPlayback';

/** 构造带 effect.sound 的 ViewEvent(extractSound 优先读 event.effect) */
function ev(sound: string | undefined, volume?: number): ViewEvent {
  return { type: '打出', effect: sound ? { sound, volume } : undefined } as unknown as ViewEvent;
}

function q(seq: number, event: ViewEvent): QueuedEvent {
  return { seq, event };
}

describe('useSoundPlayback', () => {
  beforeEach(() => {
    playMock.mockClear();
    getDurationMock.mockClear();
    getDurationMock.mockReturnValue(0.3);
  });

  it('动作音效逐个串行播放:一批事件入队后,间隔基于音频时长逐个响(不叠)', async () => {
    vi.useFakeTimers();
    try {
      renderHook((ing) => useSoundPlayback(ing), {
        initialProps: null as QueuedEvent[] | null,
      });
      const { rerender } = renderHook(
        (ing) => useSoundPlayback(ing),
        { initialProps: [q(1, ev('flip')), q(2, ev('flip'))] as QueuedEvent[] },
      );
      // 两个动作音效:seq1 立即播,seq2 等 gap(0.3s*0.7=210ms)后播
      expect(playMock).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(playMock).toHaveBeenCalledTimes(2);
      rerender(undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it('氛围音效立即响(fire-and-forget),不串行等待', () => {
    vi.useFakeTimers();
    try {
      renderHook((ing) => useSoundPlayback(ing), {
        initialProps: [
          q(1, ev('turn_start')),
          q(2, ev('turn_end')),
          q(3, ev('phase_start')),
        ] as QueuedEvent[],
      });
      // 三个氛围音效全部立即响,无需等待
      expect(playMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('氛围与动作混合:氛围立即响,动作进串行队列', () => {
    vi.useFakeTimers();
    try {
      renderHook((ing) => useSoundPlayback(ing), {
        initialProps: [
          q(1, ev('turn_start')),
          q(2, ev('flip')),
        ] as QueuedEvent[],
      });
      // 氛围立即响 + 动作队列首项立即响 = 2 次
      expect(playMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('null / undefined / 空数组 不播放', () => {
    const { rerender } = renderHook((ing) => useSoundPlayback(ing), {
      initialProps: undefined as QueuedEvent[] | undefined,
    });
    rerender(undefined);
    rerender([] as QueuedEvent[]);
    expect(playMock).not.toHaveBeenCalled();
  });

  it('无 sound 的事件不播放', () => {
    renderHook((ing) => useSoundPlayback(ing), {
      initialProps: [q(1, ev(undefined))] as QueuedEvent[],
    });
    expect(playMock).not.toHaveBeenCalled();
  });

  it('volume 透传给 audioEngine.play', () => {
    vi.useFakeTimers();
    try {
      renderHook((ing) => useSoundPlayback(ing), {
        initialProps: [q(1, ev('heal', 0.4))] as QueuedEvent[],
      });
      expect(playMock).toHaveBeenCalledWith('heal', 0.4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('同一批次重复渲染不重复播放(seq 单调递增过滤)', () => {
    vi.useFakeTimers();
    try {
      const batch = [q(1, ev('turn_start'))] as QueuedEvent[];
      const { rerender } = renderHook((ing) => useSoundPlayback(ing), {
        initialProps: batch,
      });
      rerender(batch); // 同一引用
      expect(playMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // cleanup→remount 回归测试:模拟 StrictMode 的 mount→cleanup→remount。
  // 旧实现用独立 playingRef 控制串行,cleanup 清了 timer 但没重置 playingRef →
  // remount 后 drain() 永远 return → 所有动作音效卡死。
  // 修复:用 timerRef.current !== null 判断播放状态,cleanup 清 timer(null)即解锁。
  it('cleanup 后重新 mount:动作音效不卡死,新事件正常播放', () => {
    vi.useFakeTimers();
    try {
      // 第一次 mount:flip 入队 → drain → play(1次)
      const { unmount } = renderHook((ing) => useSoundPlayback(ing), {
        initialProps: [q(1, ev('flip'))] as QueuedEvent[],
      });
      expect(playMock).toHaveBeenCalledTimes(1);

      // 模拟 StrictMode cleanup:清 timer。
      // 旧 bug:playingRef 仍为 true。新实现:timerRef=null(解锁)。
      unmount();

      // 重新 mount(新 hook 实例,新 ref):旧 bug 下新实例的 playingRef 也会被首次
      // drain 设 true 然后 cleanup 清 timer 不重置 → 卡死。
      // 这里验证新实例的正常路径:新事件入队 → drain → play
      renderHook((ing) => useSoundPlayback(ing), {
        initialProps: [q(1, ev('flip'))] as QueuedEvent[],
      });
      expect(playMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
