// 卡牌描述浮层:替代 HandCard 原生 title 属性的自定义 tooltip。
// - 桌面:hover 显示(仅真 hover 设备,触屏合成的 mouse 事件不触发);hover 打开的浮层点卡仍正常选牌。
// - 触屏:长按 ~500ms 显示;touchmove(拖拽重排)即取消计时。
// - 浮层开着时:点卡关闭(长按打开的不选牌);点别处(window pointerdown)/滚动 = 关闭。
// - 长按触发后手指抬起的 click 在 1s 时间窗内被吞掉,避免误选牌。
// - 浮层通过 createPortal 渲染到 document.body:绕开手牌区溢出裁剪与
//   扇形排布的 z-index 堆叠,相邻卡牌不会遮挡(参照 useHoverTooltip 的做法)。
// 视觉对齐 useHoverTooltip/SkillTooltip:暗色底 + 金色细边框。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { css } from '@linaria/core';

/** 长按触发阈值:超过该时长未移动/抬起则弹出描述浮层 */
const LONG_PRESS_MS = 500;

// 浮层气泡:与 useHoverTooltip 的 tooltipBubble 同款视觉(暗色底/金边/阴影)
const cardDescBubble = css`
  position: fixed;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.95);
  color: #f0e6d3;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
  max-width: 300px;
  min-width: 140px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 215, 0, 0.2);
  pointer-events: none;
  display: flex;
  flex-direction: column;
`;

// 标题行:牌名 + 花色点数,颜色随花色(黑/灰 vs 红),由内联 style 传入
const cardDescTitle = css`
  font-weight: bold;
  font-size: 13px;
`;

// 描述正文
const cardDescBody = css`
  display: block;
`;

// 转化模式原牌名:弱化斜体,对齐 hand.ts 的 cardOrigin 风格
const cardDescOrigin = css`
  font-size: 11px;
  opacity: 0.7;
  font-style: italic;
`;

// 长按防误触守卫:屏蔽 iOS 长按系统 callout 与文本选择(挂在卡牌元素上)
export const cardTouchGuard = css`
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
`;

/** 浮层内容(由 HandCard 从 card/转化状态派生) */
export interface CardDescContent {
  /** 展示牌名(转化模式下为转化后的牌名) */
  name: string;
  suit: string;
  rank: string;
  description?: string;
  /** 转化模式:原牌名 */
  originName?: string;
  /** 花色文字色(♠♣灰 / ♥♦红) */
  suitColor: string;
}

/**
 * 卡牌描述浮层 hook:返回 bind(展开到卡牌元素) + consumeClick(click 时调用,
 * 返回 true 表示该次点击被浮层吞掉,不应触发选牌) + overlay(放 JSX 末尾)。
 * 全部状态在组件内部,不新增 HandCard props,不影响 memo 比较器。
 */
export function useCardDescOverlay(content: CardDescContent): {
  bind: {
    ref: RefObject<HTMLDivElement | null>;
    onMouseEnter: (e: ReactMouseEvent) => void;
    onMouseLeave: () => void;
    onTouchStart: (e: ReactTouchEvent) => void;
    onTouchEnd: (e: ReactTouchEvent) => void;
    onTouchMove: (e: ReactTouchEvent) => void;
    onContextMenu: (e: ReactMouseEvent) => void;
  };
  /** 点击卡牌时调用:返回 true 则该 click 被浮层消费(不选牌) */
  consumeClick: () => boolean;
  overlay: ReactNode;
} {
  const [open, setOpen] = useState(false);
  // 锚点:卡牌可视矩形 top + 水平中点(portal 到 body 后 fixed 定位用)
  const [anchor, setAnchor] = useState({ top: 0, centerX: 0 });
  const cardElRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  // 打开来源:hover 打开的浮层,随后点卡 = 正常选牌(仅顺带关闭);
  // 长按(touch)打开的浮层,再点卡 = 仅关闭不选牌。
  const openSourceRef = useRef<'hover' | 'touch' | null>(null);
  // 长按触发后的 click 抑制窗口:时间窗判断,兼容部分浏览器长按后不派发 click
  // (标志位永不消费导致误吞下一次点击)的情况。
  const suppressClickUntil = useRef(0);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const show = useCallback((source: 'hover' | 'touch') => {
    const el = cardElRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    openSourceRef.current = source;
    setAnchor({ top: rect.top, centerX: rect.left + rect.width / 2 });
    setOpen(true);
  }, []);

  // 卸载时清理长按计时器
  useEffect(() => clearLongPress, [clearLongPress]);

  // 浮层开着时:点别处关闭(portal 浮层自身 pointer-events:none,不会成为 target);
  // 滚动/缩放视口时锚点会漂移,直接关闭。点卡本身交给 onClick/consumeClick 处理。
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (ev: PointerEvent) => {
      if (cardElRef.current?.contains(ev.target as Node)) return;
      setOpen(false);
    };
    const onAnyScroll = () => setOpen(false);
    window.addEventListener('pointerdown', onDocPointerDown);
    window.addEventListener('scroll', onAnyScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onDocPointerDown);
      window.removeEventListener('scroll', onAnyScroll, true);
    };
  }, [open]);

  // 桌面 hover:仅真 hover 设备响应(触屏 tap 也会合成 mouseenter,需排除)
  const onMouseEnter = useCallback(() => {
    if (!window.matchMedia('(hover: hover)').matches) return;
    show('hover');
  }, [show]);
  // 仅关闭 hover 打开的浮层:触屏长按后浏览器可能补发合成 mouseleave,
  // 不加来源判断会令长按浮层刚打开就被关掉。
  const onMouseLeave = useCallback(() => {
    if (openSourceRef.current === 'hover') setOpen(false);
  }, []);

  // 触屏长按:touchstart 起计时;touchmove(含拖拽重排)或 touchend 取消。
  const onTouchStart = useCallback(() => {
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      suppressClickUntil.current = Date.now() + 1000;
      show('touch');
    }, LONG_PRESS_MS);
  }, [clearLongPress, show]);

  const cancelLongPress = useCallback(() => clearLongPress(), [clearLongPress]);

  // 长按期间/浮层开着时屏蔽移动端长按系统菜单
  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      if (open || longPressTimer.current !== null) e.preventDefault();
    },
    [open],
  );

  const consumeClick = useCallback(() => {
    if (Date.now() < suppressClickUntil.current) {
      suppressClickUntil.current = 0;
      return true;
    }
    if (open) {
      setOpen(false);
      // 长按打开的浮层:再点卡 = 仅关闭不选牌;hover 打开的:点卡正常选牌
      return openSourceRef.current === 'touch';
    }
    return false;
  }, [open]);

  const overlay = open
    ? createPortal(
        <div
          className={cardDescBubble}
          style={{ top: anchor.top - 8, left: anchor.centerX, transform: 'translate(-50%, -100%)' }}
        >
          <span className={cardDescTitle} style={{ color: content.suitColor }}>
            {content.name} {content.suit}
            {content.rank}
          </span>
          {content.description && <span className={cardDescBody}>{content.description}</span>}
          {content.originName && <span className={cardDescOrigin}>(原: {content.originName})</span>}
        </div>,
        document.body,
      )
    : null;

  return {
    bind: {
      ref: cardElRef,
      onMouseEnter,
      onMouseLeave,
      onTouchStart,
      onTouchEnd: cancelLongPress,
      onTouchMove: cancelLongPress,
      onContextMenu,
    },
    consumeClick,
    overlay,
  };
}
