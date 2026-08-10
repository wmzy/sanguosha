// src/client/components/CountdownBar.tsx
// 统一倒计时进度条:顺滑 rAF 进度条 + 每秒刷新的秒数文字。
// 抽出供 GameView / CharSelectOverlay 等多处复用。

import { css } from '@linaria/core';
import { useCountdownSeconds, useCountdownFraction } from '../hooks/useCountdown';

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
