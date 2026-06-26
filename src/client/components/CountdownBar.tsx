// src/client/components/CountdownBar.tsx
// 统一倒计时进度条:顺滑 rAF 进度条 + 每秒刷新的秒数文字。
// 抽出供 GameView / CharSelectOverlay 等多处复用。

import { useState, useEffect, useRef, type RefObject } from 'react';
import { css } from '@linaria/core';

/** 倒计时默认总时长(15s),引擎 pending 未带 totalMs 时兜底 */
export const DEFAULT_COUNTDOWN_TOTAL_MS = 15_000;

// ─── 统一倒计时进度条 ───
const countdownBar = css`
  position: relative;
  width: 100%;
  height: 20px;
  background: rgba(231, 126, 34, 0.15);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(231, 126, 34, 0.3);
`;

const countdownBarFill = css`
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, #f39c12, #e74c3c);
  border-radius: 3px;
`;

const countdownBarText = css`
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  font-size: 13px;
  font-weight: bold;
  color: #fff;
  text-shadow:
    0 0 3px rgba(0, 0, 0, 0.9),
    0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
  z-index: 1;
`;

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

interface CountdownBarProps {
  deadline: number | null;
  totalMs: number;
}

/** 统一倒计时进度条:上方秒数文字 + 下方渐变进度条。 */
export function CountdownBar({ deadline, totalMs }: CountdownBarProps) {
  const fillRef = useCountdownFraction(deadline, totalMs);
  const sec = useCountdownSeconds(deadline);
  if (deadline == null || sec == null) return null;
  return (
    <div className={countdownBar} title={`剩余 ${sec} 秒`}>
      <div className={countdownBarFill} ref={fillRef} />
      <span className={countdownBarText}>⏱ {sec}s</span>
    </div>
  );
}
