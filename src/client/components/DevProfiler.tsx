// src/client/components/DevProfiler.tsx
// 开发模式专用的 React Profiler 包装组件。
//
// 生产构建中 import.meta.env.DEV 为 false,组件直接返回 children(零开销)。
// 开发模式下用 <Profiler> 包裹子树,在 console 周期性输出渲染次数和平均耗时,
// 帮助定位不必要的重渲染。
//
// 用法:
//   <DevProfiler id="PlayerSeatView">{children}</DevProfiler>
//
// 输出示例(console.debug):
//   [Profiler] PlayerSeatView: 30 renders, avg 0.42ms (last 0.30ms)

import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';

interface RenderStats {
  count: number;
  totalTime: number;
  lastTime: number;
}

const stats = new Map<string, RenderStats>();

const LOG_INTERVAL = 20; // 每 N 次渲染输出一次汇总

const onRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  const entry = stats.get(id);
  if (entry) {
    entry.count++;
    entry.totalTime += actualDuration;
    entry.lastTime = actualDuration;
  } else {
    stats.set(id, { count: 1, totalTime: actualDuration, lastTime: actualDuration });
  }

  const s = stats.get(id)!;
  if (s.count % LOG_INTERVAL === 0) {
    const avg = (s.totalTime / s.count).toFixed(2);
    const last = s.lastTime.toFixed(2);
    console.debug(
      `[Profiler] ${id}: ${s.count} renders, avg ${avg}ms (last ${last}ms)`,
    );
  }
};

interface DevProfilerProps {
  /** Profiler 标识符,用于区分不同子树 */
  id: string;
  children: ReactNode;
}

/**
 * 开发模式 React.Profiler 包装。生产构建为透传组件。
 * 用 DEV 标志做编译期消除,确保生产包零开销。
 */
export function DevProfiler({ id, children }: DevProfilerProps) {
  if (!import.meta.env.DEV) return <>{children}</>;
  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
