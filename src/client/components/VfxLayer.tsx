// src/client/components/VfxLayer.tsx
// Lottie 特效渲染层。独立 z-index（顶层），pointer-events:none（不拦截交互）。
//
// 接收 useVfxPlayback 产出的 items，每条 item 入「活动列表」播放；
// 播放 2s 后自动回收（Lottie 动画通常 < 2s，超时兜底防泄漏）。
//
// 设计与 EventBanner 一致：非阻塞、纯展示、固定层。

import { useEffect, useRef, useState } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';
import type { VfxPlaybackItem } from '../hooks/useVfxPlayback';

/** 单个特效的最大存活时长（ms），到期无论动画状态都从 DOM 移除 */
const VFX_TTL_MS = 2000;

interface ActiveVfx extends VfxPlaybackItem {
  startedAt: number;
}

interface VfxLayerProps {
  items: VfxPlaybackItem[];
}

export function VfxLayer({ items }: VfxLayerProps) {
  const [active, setActive] = useState<ActiveVfx[]>([]);

  // 新 items 到来：并入活动列表（附加 startedAt 用于回收判定）
  useEffect(() => {
    if (items.length === 0) return;
    const now = Date.now();
    setActive((prev) => [...prev, ...items.map((i) => ({ ...i, startedAt: now }))]);
  }, [items]);

  // 活动列表非空时：设一个兜底定时器，到点剔除过期项
  useEffect(() => {
    if (active.length === 0) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setActive((prev) => prev.filter((a) => now - a.startedAt < VFX_TTL_MS));
    }, VFX_TTL_MS + 100);
    return () => clearTimeout(timer);
  }, [active]);

  if (active.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {active.map((v) => (
        <LottiePlayer key={v.key} url={v.url} />
      ))}
    </div>
  );
}

interface LottiePlayerProps {
  url: string;
}

function LottiePlayer({ url }: LottiePlayerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let anim: AnimationItem | undefined;
    let cancelled = false;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        // 卸载后异步 resolve 到达：忽略，避免写入已脱离 DOM 的容器
        if (cancelled || !ref.current) return;
        anim = lottie.loadAnimation({
          container: ref.current,
          renderer: 'svg',
          loop: false,
          autoplay: true,
          animationData: data,
        });
      })
      .catch(() => {
        /* 资源缺失/解析失败：静默 */
      });

    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, [url]);

  return <div ref={ref} style={{ width: 400, height: 400 }} />;
}
