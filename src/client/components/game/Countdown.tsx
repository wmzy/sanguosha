// src/components/game/Countdown.tsx — 倒计时子组件
//
// 内部拥有 200ms 定时器，自行维护剩余秒数状态。
// 父组件无需持有定时器状态——避免了原 GameBoard 树每 200ms 整体重渲染的问题。
//
// T8 引入此组件以修复 #1：200ms setInterval 整棵 GameBoard 树重渲染。

import { useState, useEffect } from 'react';

interface CountdownProps {
  /** 截止时间戳（毫秒）；null/undefined 时不启动定时器 */
  deadline: number | null;
  /** 定时器更新间隔（毫秒），默认 200 */
  intervalMs?: number;
}

export function Countdown({ deadline, intervalMs = 200 }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null || deadline === undefined) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [deadline, intervalMs]);

  if (deadline === null || deadline === undefined) {
    return null;
  }

  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function useCountdownSeconds(deadline: number | null, intervalMs = 200): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [deadline, intervalMs]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
