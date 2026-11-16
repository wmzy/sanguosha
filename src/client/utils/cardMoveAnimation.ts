// src/client/utils/cardMoveAnimation.ts
// 卡牌移动飞行动画:一个浮动容器携带 N 张牌从起点飞向终点。
//
// 与 cardFlyAnimation.ts(出牌→中央单牌)的区别:
//   - 本工具面向"区域间转移"场景(摸牌/仁德/好施/破军等),一次移动 N 张牌。
//   - 用户决策:多张牌放在同一容器内一起移动,不逐张错峰。
//   - 支持明牌(事件携带牌面时)与扣置(牌背)两种渲染。
//
// 坐标锚点:通过 data-zone-anchor / data-seat-index 属性定位 DOM 元素,
// 读取 getBoundingClientRect 取屏幕坐标。锚点不存在时降级到视口估算位置。
//
// keyframe `flyCardMove` 定义在 src/client/animations.css(全局)。
// 浮动 div 骨架(定位/--fly-dx/dy/animationend+超时兜底移除)与明牌两行子元素
// 由 flyCardOverlay 基座提供。

import { createFaceLines, spawnFlyContainer, type FlyCardFace } from './flyCardOverlay';

export type { FlyCardFace };

// ─── 浮动卡牌视觉常量 ───
const CARD_W = 46;
const CARD_H = 64;
/** 多张牌横排时的重叠步进(每张右移这么多的可见宽度) */
const CARD_STEP = 22;
const FLY_DURATION_MS = 840;

// 明牌配色
const FACE_BG = 'rgba(22,33,62,0.96)';
const FACE_BORDER = '#3a5a8c';
const FACE_SHADOW = '0 0 12px rgba(58,90,140,0.5)';
// 扣置牌背配色
const BACK_BG = 'linear-gradient(135deg, #1e2d4a 0%, #0d1525 100%)';
const BACK_BORDER = '#2c4068';
const BACK_PATTERN = '✦';

/** 动画锚点:定位起止区域的 DOM 元素 */
export type AnchorTarget =
  | { kind: 'deck' }
  | { kind: 'discard' }
  | { kind: 'seat'; index: number }
  | { kind: 'offscreen' };

interface Rect {
  cx: number;
  cy: number;
}

const DECK_SELECTOR = '[data-zone-anchor="deck"]';
const DISCARD_SELECTOR = '[data-zone-anchor="discard"]';

function seatSelector(index: number): string {
  return `[data-seat-index="${index}"]`;
}

/** 解析锚点元素的中心坐标;元素不存在或不可见时返回 null */
function resolveAnchor(target: AnchorTarget): Rect | null {
  if (target.kind === 'offscreen') {
    // 移出游戏:飞向屏幕上方边缘外
    return { cx: window.innerWidth / 2, cy: -80 };
  }
  let selector: string;
  switch (target.kind) {
    case 'deck':
      selector = DECK_SELECTOR;
      break;
    case 'discard':
      selector = DISCARD_SELECTOR;
      break;
    case 'seat':
      selector = seatSelector(target.index);
      break;
  }
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // 元素不可见(零面积)时视为无效
  if (r.width === 0 && r.height === 0) return null;
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

/** 锚点解析失败时的降级坐标 */
function fallbackRect(target: AnchorTarget): Rect {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  switch (target.kind) {
    case 'deck':
    case 'discard':
      // 牌堆/弃牌堆位于中央偏上
      return { cx, cy: window.innerHeight * 0.32 };
    case 'seat':
      return { cx, cy };
    case 'offscreen':
      return { cx, cy: -80 };
  }
}

/** 计算容器宽度:N 张牌横排 */
function containerWidth(count: number): number {
  if (count <= 0) return CARD_W;
  return CARD_W + (count - 1) * CARD_STEP;
}

// 明牌两行排版(小卡多张横排,字号缩小);花色着色由基座的 createFaceLines 统一处理
const FACE_NAME_CSS = 'font-size: 12px; font-weight: bold; line-height: 1.2; text-align: center; padding: 0 2px;';
const FACE_SUIT_CSS = 'font-size: 10px; margin-top: 2px;';

/** 渲染单张明牌子元素 */
function createFaceCard(face: FlyCardFace): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `
    position: absolute; width: ${CARD_W}px; height: ${CARD_H}px;
    border: 1.5px solid ${FACE_BORDER}; border-radius: 6px;
    background: ${FACE_BG}; box-sizing: border-box; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    box-shadow: ${FACE_SHADOW};
  `;
  for (const line of createFaceLines(face, FACE_NAME_CSS, FACE_SUIT_CSS)) el.appendChild(line);
  return el;
}

/** 渲染单张扣置牌背子元素 */
function createBackCard(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `
    position: absolute; width: ${CARD_W}px; height: ${CARD_H}px;
    border: 1.5px solid ${BACK_BORDER}; border-radius: 6px;
    background: ${BACK_BG}; box-sizing: border-box; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 8px rgba(44,64,104,0.4);
  `;
  const pattern = document.createElement('div');
  pattern.style.cssText = `font-size: 18px; color: rgba(120,150,200,0.25);`;
  pattern.textContent = BACK_PATTERN;
  el.appendChild(pattern);
  return el;
}

/**
 * 创建浮动容器并飞向终点,动画结束后自动移除。
 *
 * @param from    起点锚点
 * @param to      终点锚点
 * @param faces   牌面数组(明牌)。数组为空或元素为 null 时渲染扣置牌背;
 *                混合时按元素是否为 null 区分明暗。
 * @param count   总牌数(faces 长度不足时用扣置补足);缺省取 faces.length
 */
export function flyCards(
  from: AnchorTarget,
  to: AnchorTarget,
  faces: (FlyCardFace | null)[],
  count?: number,
): void {
  const total = count ?? faces.length;
  if (total <= 0) return;

  const fromRect = resolveAnchor(from) ?? fallbackRect(from);
  const toRect = resolveAnchor(to) ?? fallbackRect(to);

  const cWidth = containerWidth(total);

  // 逐张摆放牌:明牌用 faces[i],超出 faces 长度或 null 的位置渲染牌背
  const cards: HTMLElement[] = [];
  for (let i = 0; i < total; i++) {
    const face = faces[i];
    const cardEl = face ? createFaceCard(face) : createBackCard();
    cardEl.style.left = `${i * CARD_STEP}px`;
    cards.push(cardEl);
  }

  // 容器左上角取「使容器中心对齐起点中心」;位移量 = 终点中心 - 起点中心
  spawnFlyContainer({
    left: fromRect.cx - cWidth / 2,
    top: fromRect.cy - CARD_H / 2,
    width: cWidth,
    height: CARD_H,
    dx: toRect.cx - fromRect.cx,
    dy: toRect.cy - fromRect.cy,
    zIndex: 9998,
    animationName: 'flyCardMove',
    durationMs: FLY_DURATION_MS,
    children: cards,
  });
}
