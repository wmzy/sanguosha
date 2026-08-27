// src/client/components/VfxLayer.tsx
// 特效渲染层。独立 z-index（顶层），pointer-events:none（不拦截交互）。
//
// 接收 useVfxPlayback 产出的 items，每条 item 入「活动列表」播放；
// 播放后自动回收（Lottie/APNG 动画通常 < 2.5s，超时兜底防泄漏）。
//
// 支持两种特效格式：
//   - Lottie JSON（.json）：通过 lottie-web 渲染矢量动画
//   - APNG（.apng）：通过 <img> 标签渲染逐帧动画（浏览器原生支持）
// url 后缀决定播放器选择。
//
// 设计与 EventBanner 一致：非阻塞、纯展示、固定层。

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { AnimationItem } from 'lottie-web';
import type { GameView } from '../../engine/types';
import type { VfxPlaybackItem } from '../hooks/useVfxPlayback';
import { findSeatCenter } from '../utils/gameViewHelpers';

/** 单个特效的最大存活时长（ms），到期无论动画状态都从 DOM 移除。
 *  APNG 动效帧数较多(如 fire_slash 24帧@12fps=2s)，给足余量。 */
const VFX_TTL_MS = 2500;

interface ActiveVfx extends VfxPlaybackItem {
  startedAt: number;
}

interface VfxLayerProps {
  items: VfxPlaybackItem[];
  /** 当前视图:用于查询座次 DOM,把有目标的动效定位到对应武将卡。 */
  view: GameView;
}

export function VfxLayer({ items, view }: VfxLayerProps) {
  const [active, setActive] = useState<ActiveVfx[]>([]);
  // 已入活动列表的 item key 集合。
  // useVfxPlayback 的 items 是累积式（每批新 vfx 追加，从不缩减），
  // 若每次 items 变化都把整个数组并入 active，历史特效会被重复播放
  // （出杀后再吃桃，杀的特效会再次触发）。用此集合去重，每个 key 只入一次。
  const processedKeysRef = useRef(new Set<string>());

  // 新 items 到来：仅并入未处理的新增项（附加 startedAt 用于回收判定）
  useEffect(() => {
    const fresh = items.filter((i) => !processedKeysRef.current.has(i.key));
    if (fresh.length === 0) return;
    for (const f of fresh) processedKeysRef.current.add(f.key);
    const now = Date.now();
    const newActive = fresh.map((item) => ({ ...item, startedAt: now }));
    setActive((prev) => [...prev, ...newActive]);
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

  // 通过 createPortal 挂到 document.body(与 useHoverTooltip/CardDescTooltip 同范式):
  // 本组件渲染在 GameViewScaler 的 transform 祖先内——transform 会让 position:fixed
  // 改以画布为 containing block(而非视口),而 findSeatCenter 返回的是已含缩放的
  // 视口坐标,scale≠1 时特效会整体偏移。portal 到 body 后脱离 transform 上下文,
  // fixed + 视口坐标天然对齐。z-index 9000:画布(scalerInner 的 transform)整体
  // 构成一个层叠上下文,portal 元素位于 body 根上下文必绘于其上;数值上与
  // 聊天/InfoDock 同档,低于全屏遮罩(9998)/选将·结算(10100)/tooltip(99999)
  // 的既定层级语义。jsdom 下 document.body 存在,portal 本身安全。
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9000,
      }}
    >
      {active.map((v) => (
        <VfxSlot key={v.key} item={v} view={view} />
      ))}
    </div>,
    document.body,
  );
}

/** 单个特效定位槽:有目标 → 定位到对应座次中心;无目标/找不到 → 屏幕居中。 */
function VfxSlot({ item, view }: { item: ActiveVfx; view: GameView }) {
  const center =
    item.target !== undefined ? findSeatCenter(view, item.target) : null;
  const style: CSSProperties = center
    ? {
        position: 'absolute',
        left: center.left,
        top: center.top,
        transform: 'translate(-50%, -50%)',
      }
    : {
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
      };
  return (
    <div style={style}>
      {item.url.endsWith('.apng') ? (
        <ApngPlayer url={item.url} />
      ) : (
        <LottiePlayer url={item.url} />
      )}
    </div>
  );
}

/** APNG 播放器：浏览器原生支持 APNG 动画，直接用 <img> 渲染。 */
function ApngPlayer({ url }: { url: string }) {
  return (
    <img
      src={url}
      style={{ width: 400, height: 400, objectFit: 'contain' }}
      alt=""
      draggable={false}
    />
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
      .then(async (data) => {
        // 卸载后异步 resolve 到达：忽略，避免写入已脱离 DOM 的容器
        if (cancelled || !ref.current) return;
        // 动态 import：避免 lottie-web 模块加载时的 canvas 副作用（jsdom 环境崩溃）
        const { default: lottie } = await import('lottie-web');
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
