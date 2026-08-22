// src/client/components/GameViewScaler.tsx
// 游戏画面等比缩放容器:参照官方三国杀客户端的「固定逻辑分辨率 + 整体缩放」范式。
//
// 问题:GameView 内部大量 px 定值(武将卡 200px / 侧栏 250px / 座位卡 148px),
// 直接铺满视口时小屏放不下、大屏留白多,且各区域缩放不一致。
// 方案:以设计高度 900px 为基准,宽度按可用区域宽高比在 [1280, 2240] 内流式伸缩,
// 整块画布用 transform: scale() 等比缩放——任何屏幕都全屏铺满、内部元素等比缩放。
//
// 尺寸规则(outer 为父容器给的可用矩形 W×H):
//   fitW    = W * 900 / H            (高度贴满时所需的画布宽)
//   canvasW = clamp(fitW, MIN_W, MAX_W)
//   scale   = min(H / 900, W / canvasW)
//   → 常规桌面比例(16:9/16:10/3:2/21:9):scale=H/900,渲染宽度恰好=W,真全屏无黑边;
//   → 过窄(竖屏/分屏):scale=W/MIN_W,上下留边(等比不裁切);
//   → 超宽(scale 被 MAX_W 钳制):左右留边。
//
// 定位全部由 JS 计算(tx/ty 居中偏移 + scale),避免 CSS transform 百分比在
// 缩放叠加时的语义歧义。ResizeObserver 驱动,窗口拖拽实时重排。

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { css } from '@linaria/core';

/** 设计基准高度(px):GameView 内部定值按此高度下的观感调校 */
const DESIGN_H = 900;
/** 画布最小/最大设计宽度:低于 MIN_W 等比缩小并上下留边,高于 MAX_W 左右留边 */
const MIN_W = 1280;
const MAX_W = 2240;

const scalerOuter = css`
  position: relative;
  overflow: hidden;
  width: 100%;
`;

const scalerInner = css`
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
`;

export interface GameViewScalerProps {
  children: ReactNode;
  /**
   * 可用高度来源:
   * - 'viewport'(默认):outer 高度恒等于视口高(GameView 即页面的挂载方式)。
   * - 'fill':outer 高度 100%,占满 flex 父容器的剩余高度(如回放页顶部有控制条)。
   */
  fit?: 'viewport' | 'fill';
}

interface Metrics {
  /** 画布设计宽 */
  canvasW: number;
  /** 等比缩放系数 */
  scale: number;
  /** 居中偏移(canvas 渲染尺寸小于 outer 时 ≥0;溢出时为负,对称裁切) */
  tx: number;
  ty: number;
}

function computeMetrics(W: number, H: number): Metrics {
  if (W <= 0 || H <= 0) return { canvasW: MIN_W, scale: 1, tx: 0, ty: 0 };
  const fitW = (W * DESIGN_H) / H;
  const canvasW = Math.min(MAX_W, Math.max(MIN_W, fitW));
  const scale = Math.min(H / DESIGN_H, W / canvasW);
  const tx = (W - canvasW * scale) / 2;
  const ty = (H - DESIGN_H * scale) / 2;
  return { canvasW, scale, tx, ty };
}

export function GameViewScaler({ children, fit = 'viewport' }: GameViewScalerProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  // 初始值按视口同步求值避免首帧闪现;layout-effect 内会按真实盒子立即纠正
  // (fill 模式下父级高度与视口不同,首帧值只是近似)。
  const [metrics, setMetrics] = useState<Metrics>(() =>
    computeMetrics(window.innerWidth, window.innerHeight),
  );

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    // viewport 模式:高度先于首帧写死为视口高(fill 模式交给父级 flex 决定)
    const applyHeight = () => {
      if (fit === 'viewport') el.style.height = `${window.innerHeight}px`;
    };
    applyHeight();
    const update = () => setMetrics(computeMetrics(el.clientWidth, el.clientHeight));
    update();
    // ResizeObserver 在 jsdom(测试环境)不存在:回退为仅监听窗口 resize,
    // 真实浏览器全支持 RO(父容器尺寸变化如侧栏开合也能响应)。
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', applyHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', applyHeight);
    };
  }, [fit]);

  return (
    <div
      ref={outerRef}
      className={scalerOuter}
      style={fit === 'fill' ? { height: '100%' } : undefined}
    >
      <div
        className={scalerInner}
        style={{
          width: metrics.canvasW,
          height: DESIGN_H,
          transform: `translate(${metrics.tx}px, ${metrics.ty}px) scale(${metrics.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
