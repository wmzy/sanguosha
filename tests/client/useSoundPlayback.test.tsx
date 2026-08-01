// @vitest-environment jsdom
// tests/client/useSoundPlayback.test.tsx
// useSoundPlayback hook 行为测试:验证音效跟随播放队列的 current 事件逐个串行播放,
// 同一 seq 不重复,无声/null 不播放,volume 透传。
//
// 放置说明:useSoundPlayback 是音效播放 hook(非 skill、非 integration),原无对应测试。
// 按 AGENTS.md「仅以上都不适用时才新建文件」,音效播放层无现成归属,故新建此文件,
// 与 tests/client/ 下其它独立 hook 测试(useAnimationState/useReplay/…)同构。
// 该测试锁定「跟随 current 串行、不叠音」契约,防止回归到「监听 ingested 批次同步全播」。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ViewEvent } from '../../src/engine/types';

// mock audioEngine:jsdom 无 AudioContext,且我们要断言 play 调用次数/参数
// vi.hoisted 保证 mock 工厂(vitest 会提升到顶部)能引用到 playMock
const { playMock } = vi.hoisted(() => ({ playMock: vi.fn() }));
vi.mock('../../src/client/sounds/audioEngine', () => ({
  audioEngine: { play: playMock },
}));

import { useSoundPlayback } from '../../src/client/hooks/useSoundPlayback';
import type { QueuedEvent } from '../../src/client/hooks/useEventPlayback';

/** 构造带 effect.sound 的 ViewEvent(extractSound 优先读 event.effect,不走 getAtomDef) */
function ev(sound: string | undefined, volume?: number): ViewEvent {
  return { type: '打出', effect: sound ? { sound, volume } : undefined } as unknown as ViewEvent;
}

function q(seq: number, event: ViewEvent): QueuedEvent {
  return { seq, event };
}

describe('useSoundPlayback', () => {
  beforeEach(() => playMock.mockClear());

  it('跟随 current 逐个播放:一批事件经 current 逐个切换,每次只响一声(不叠)', () => {
    // 模拟一次操作产生 3 个事件,经 useEventPlayback 逐个出队成为 current
    const { rerender } = renderHook((cur) => useSoundPlayback(cur), {
      initialProps: null as QueuedEvent | null,
    });
    rerender(q(1, ev('play_card')));
    rerender(q(2, ev('target')));
    rerender(q(3, ev('damage_physical')));

    expect(playMock).toHaveBeenCalledTimes(3);
    expect(playMock).toHaveBeenNthCalledWith(1, 'play_card', undefined);
    expect(playMock).toHaveBeenNthCalledWith(2, 'target', undefined);
    expect(playMock).toHaveBeenNthCalledWith(3, 'damage_physical', undefined);
  });

  it('同一 seq 不重复播放(防 React 重渲染 / StrictMode 双触发叠音)', () => {
    const { rerender } = renderHook((cur) => useSoundPlayback(cur), {
      initialProps: null as QueuedEvent | null,
    });
    const same = q(1, ev('play_card'));
    rerender(same);
    rerender(same); // 同一对象、同一 seq 再次渲染

    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('null / undefined 不播放', () => {
    const { rerender, result } = renderHook((cur) => useSoundPlayback(cur), {
      initialProps: null as QueuedEvent | null,
    });
    rerender(null);
    rerender(undefined as unknown as QueuedEvent);
    expect(playMock).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  it('无 sound 的事件不播放', () => {
    const { rerender } = renderHook((cur) => useSoundPlayback(cur), {
      initialProps: null as QueuedEvent | null,
    });
    rerender(q(1, ev(undefined)));
    expect(playMock).not.toHaveBeenCalled();
  });

  it('volume 透传给 audioEngine.play', () => {
    const { rerender } = renderHook((cur) => useSoundPlayback(cur), {
      initialProps: null as QueuedEvent | null,
    });
    rerender(q(1, ev('heal', 0.4)));
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(playMock).toHaveBeenCalledWith('heal', 0.4);
  });

  it('回放 prev→next 回到已播过的不同 seq 仍重放(seq 不同即响)', () => {
    const { rerender } = renderHook((cur) => useSoundPlayback(cur), {
      initialProps: null as QueuedEvent | null,
    });
    rerender(q(5, ev('play_card'))); // next 到 seq5
    rerender(q(4, ev('flip'))); // prev 回 seq4(seq≠5 → 响)
    rerender(q(5, ev('play_card'))); // 再次 next 到 seq5(seq≠4 → 响)

    expect(playMock).toHaveBeenCalledTimes(3);
  });
});
