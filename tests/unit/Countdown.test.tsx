// LEGACY TEST: references deleted v2 modules - skipped
// tests/unit/Countdown.test.tsx — Countdown 组件 + useCountdownSeconds hook 测试
//
// T8 验收要求至少 5 个用例。覆盖：
//   - useCountdownSeconds: null deadline、future deadline、past deadline、tick 更新、deadline 变化重启
//   - Countdown 组件: null 渲染、future deadline 渲染数字

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
// import { Countdown, useCountdownSeconds } from '../../src/client/components/game/Countdown';  // LEGACY: removed (v2 module deleted)

describe.skip('useCountdownSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deadline = null 时立即返回 null', () => {
    const { result } = renderHook(() => useCountdownSeconds(null));
    expect(result.current).toBeNull();
  });

  it('未到期 deadline 返回正整数', () => {
    const futureDeadline = Date.now() + 5000;
    const { result } = renderHook(() => useCountdownSeconds(futureDeadline));
    expect(result.current).toBe(5);
  });

  it('过期 deadline 返回 0', () => {
    const pastDeadline = Date.now() - 5000;
    const { result } = renderHook(() => useCountdownSeconds(pastDeadline));
    expect(result.current).toBe(0);
  });

  it('定时器触发后剩余秒数递减', () => {
    const futureDeadline = Date.now() + 5000;
    const { result } = renderHook(() => useCountdownSeconds(futureDeadline, 200));
    expect(result.current).toBe(5);
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(result.current).toBeLessThanOrEqual(4);
  });

  it('deadline 变化时重启定时器', () => {
    const d1 = Date.now() + 3000;
    const d2 = Date.now() + 1000;
    const { result, rerender } = renderHook(({ deadline }) => useCountdownSeconds(deadline), {
      initialProps: { deadline: d1 },
    });
    expect(result.current).toBe(3);
    rerender({ deadline: d2 });
    expect(result.current).toBe(1);
  });
});

describe.skip('Countdown 组件', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deadline = null 渲染空', () => {
    const { container } = render(<Countdown deadline={null} />);
    expect(container.textContent).toBe('');
  });

  it('数值 deadline 渲染剩余秒数', () => {
    const { container } = render(<Countdown deadline={Date.now() + 5000} />);
    expect(container.textContent).toBe('5');
  });
});
