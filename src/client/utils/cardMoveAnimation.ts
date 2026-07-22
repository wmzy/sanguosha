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

import { SUIT_COLOR } from '../components/gameViewConstants';

// ─── 浮动卡牌视觉常量 ───
const CARD_W = 46;
const CARD_H = 64;
/** 多张牌横排时的重叠步进(每张右移这么多的可见宽度) */
const CARD_STEP = 22;
const FLY_DURATION_MS = 420;
const FLY_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

// 明牌配色
const FACE_BG = 'rgba(22,33,62,0.96)';
const FACE_BORDER = '#3a5a8c';
const FACE_SHADOW = '0 0 12px rgba(58,90,140,0.5)';
// 扣置牌背配色
const BACK_BG = 'linear-gradient(135deg, #1e2d4a 0%, #0d1525 100%)';
const BACK_BORDER = '#2c4068';
const BACK_PATTERN = '✦';

/** 单张牌的牌面信息(明牌时使用);为 null 表示该位置扣置 */
export interface FlyCardFace {
  name: string;
  suit: string;
  rank: string;
}

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

/** 渲染单张明牌子元素 */
function createFaceCard(face: FlyCardFace): HTMLElement {
  const suitColor = SUIT_COLOR[face.suit as keyof typeof SUIT_COLOR] ?? '#ccc';
  const el = document.createElement('div');
  el.style.cssText = `
    position: absolute; width: ${CARD_W}px; height: ${CARD_H}px;
    border: 1.5px solid ${FACE_BORDER}; border-radius: 6px;
    background: ${FACE_BG}; box-sizing: border-box; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    box-shadow: ${FACE_SHADOW};
  `;
  const name = document.createElement('div');
  name.style.cssText = `font-size: 12px; font-weight: bold; color: ${suitColor}; line-height: 1.2; text-align: center; padding: 0 2px;`;
  name.textContent = face.name;
  const suit = document.createElement('div');
  suit.style.cssText = `font-size: 10px; color: ${suitColor}; margin-top: 2px;`;
  suit.textContent = `${face.suit}${face.rank}`;
  el.appendChild(name);
  el.appendChild(suit);
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

  const flyDx = toRect.cx - fromRect.cx;
  const flyDy = toRect.cy - fromRect.cy;

  const cWidth = containerWidth(total);
  // 容器左上角:使容器中心对齐起点中心
  const left = fromRect.cx - cWidth / 2;
  const top = fromRect.cy - CARD_H / 2;

  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; left: ${left}px; top: ${top}px;
    width: ${cWidth}px; height: ${CARD_H}px;
    pointer-events: none; z-index: 9998;
    --fly-dx: ${flyDx}px; --fly-dy: ${flyDy}px;
    animation: flyCardMove ${FLY_DURATION_MS}ms ${FLY_EASING} forwards;
  `;

  // 逐张摆放牌:明牌用 faces[i],超出 faces 长度或 null 的位置渲染牌背
  for (let i = 0; i < total; i++) {
    const face = faces[i];
    const cardEl = face ? createFaceCard(face) : createBackCard();
    cardEl.style.left = `${i * CARD_STEP}px`;
    container.appendChild(cardEl);
  }

  document.body.appendChild(container);
  container.addEventListener('animationend', () => container.remove());
  // 安全兜底:若 animationend 未触发(如标签页隐藏),超时后强制移除
  setTimeout(() => container.remove(), FLY_DURATION_MS + 300);
}
