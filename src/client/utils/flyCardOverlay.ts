// src/client/utils/flyCardOverlay.ts
// 飞行卡牌浮动层基座:cardFlyAnimation(出牌单牌→屏幕中央)与 cardMoveAnimation
// (区域间 N 牌转移)共用的骨架 —— 固定定位浮动 div、--fly-dx/--fly-dy 位移变量、
// data-fly-card 标记、animationend + 超时兜底移除,以及明牌两行子元素的 SUIT_COLOR 着色。
// keyframes(flyToCenter/flyCardMove)定义在 src/client/animations.css(全局)。

import { SUIT_COLOR } from '../components/gameViewConstants';

/** 明牌牌面信息(牌名/花色/点数);花色用于 SUIT_COLOR 着色 */
export interface FlyCardFace {
  name: string;
  suit: string;
  rank: string;
}

export interface FlyContainerSpec {
  /** 浮动层几何(viewport 坐标) */
  left: number;
  top: number;
  width: number;
  height: number;
  /** 位移量(--fly-dx/--fly-dy,负值向左/上) */
  dx: number;
  dy: number;
  zIndex: number;
  /** 动画名(animations.css 中的 keyframes) */
  animationName: string;
  /** 动画时长 ms;同时是超时兜底移除的基准 */
  durationMs: number;
  /** 场景自有视觉声明(边框/底色/内边距等),追加在骨架声明之后 */
  extraCss?: string;
  children: HTMLElement[];
}

/**
 * 创建固定定位浮动容器挂到 body,动画结束后自动移除。
 * 统一缓动 cubic-bezier(0.4, 0, 0.2, 1) + forwards(保持终态)。
 */
export function spawnFlyContainer(spec: FlyContainerSpec): void {
  const floating = document.createElement('div');
  floating.style.cssText = `
    position: fixed; left: ${spec.left}px; top: ${spec.top}px;
    width: ${spec.width}px; height: ${spec.height}px;
    pointer-events: none; z-index: ${spec.zIndex};
    --fly-dx: ${spec.dx}px; --fly-dy: ${spec.dy}px;
    animation: ${spec.animationName} ${spec.durationMs}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
    ${spec.extraCss ?? ''}
  `;
  for (const child of spec.children) floating.appendChild(child);
  // data-fly-card:标记为瞬时飞行动画元素,供测试 afterEach 清理(document.body.appendChild
  // 创建的元素不受 @testing-library cleanup 管理,jsdom 又不触发 animationend → 永久泄漏)。
  floating.setAttribute('data-fly-card', '');
  document.body.appendChild(floating);
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    floating.remove();
  };
  floating.addEventListener('animationend', remove);
  // 安全兜底:animationend 在无 CSS 动画支持的环境(jsdom/标签页隐藏)永不触发,
  // 超时后强制移除,避免浮动元素残留泄漏到 document.body。
  setTimeout(remove, spec.durationMs + 300);
}

/**
 * 明牌两行子元素(牌名 + 花色点数),花色按 SUIT_COLOR 着色。
 * 字号/排版样式由调用方常量传入(两个场景字号不同,着色逻辑一致)。
 */
export function createFaceLines(face: FlyCardFace, nameCss: string, suitCss: string): HTMLElement[] {
  const suitColor = SUIT_COLOR[face.suit] ?? '#ccc';
  const name = document.createElement('div');
  name.style.cssText = `${nameCss} color: ${suitColor};`;
  name.textContent = face.name;
  const suit = document.createElement('div');
  suit.style.cssText = `${suitCss} color: ${suitColor};`;
  suit.textContent = `${face.suit}${face.rank}`;
  return [name, suit];
}
