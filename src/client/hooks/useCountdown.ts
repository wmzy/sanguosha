// src/client/hooks/useCountdown.ts
// 统一倒计时 hook:顺滑 rAF 进度条 + 每秒刷新的秒数文字。
// 从 CountdownBar.tsx 抽出,供组件文件遵守 react-refresh/only-export-components 规则。

import { useState, useEffect, useRef, type RefObject } from 'react';

/** 倒计时默认总时长(15s),引擎 pending 未带 totalMs 时兜底 */
export const DEFAULT_COUNTDOWN_TOTAL_MS = 15_000;

/** 返回剩余秒数(整数,向上取整)。用于倒计时文字显示。 */
export function useCountdownSeconds(deadline: number | null): number | null {
  const [sec, setSec] = useState<number | null>(null);
  useEffect(() => {
    if (deadline == null) {
      setSec(null);
      return;
    }
    const tick = () => setSec(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline]);
  return sec;
}

/** 顺滑倒计时:进度条用 ref 直接设 width(rAF,不触发重渲染)。
 *  注意:本 hook 只操作 ref,不触发 React 状态,需配合 CSS transition 平滑插值。 */
export function useCountdownFraction(
  deadline: number | null,
  totalMs: number = DEFAULT_COUNTDOWN_TOTAL_MS,
): RefObject<HTMLDivElement | null> {
  const fillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (deadline == null) {
      if (fillRef.current) fillRef.current.style.width = '0%';
      return;
    }
    let raf = 0;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      const frac = Math.max(0, Math.min(1, remaining / totalMs));
      if (fillRef.current) fillRef.current.style.width = `${frac * 100}%`;
      if (remaining > 0) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [deadline, totalMs]);
  return fillRef;
}
