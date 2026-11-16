// src/client/utils/cardFlyAnimation.ts
// 出牌飞行动画:手牌消失前在原位生成一个浮动卡片元素,飞向屏幕中央后移除。
// 从 GameView.tsx 抽出,所有样式常量集中于此(消除组件内的 DOM/颜色 hardcode)。
// keyframes `flyToCenter` 定义在 src/client/animations.css(全局)。
// 浮动 div 骨架(定位/--fly-dx/dy/animationend+超时兜底移除)与明牌两行子元素
// 由 flyCardOverlay 基座提供,本文件只保留单牌场景的差异部分。

import type { Card } from '../../engine/types';
import { createFaceLines, spawnFlyContainer } from './flyCardOverlay';

// ─── 飞行卡片视觉常量 ───
const FLY_BORDER = '#3498db';
const FLY_BG = 'rgba(22,33,62,0.95)';
const FLY_TEXT = '#e0e0e0';
const FLY_SHADOW = '0 0 16px rgba(52,152,219,0.6)';
const FLY_DURATION_MS = 900;
// 中央落点偏移(略高于屏幕正中)
const CENTER_Y_OFFSET = 40;

// 明牌两行排版(单牌大字,便于中央辨识);花色着色由基座的 createFaceLines 统一处理
const FACE_NAME_CSS = 'font-weight: bold; font-size: 15px; margin-bottom: 2px;';
const FACE_SUIT_CSS = 'font-size: 12px;';

/**
 * 在给定 DOM 元素位置创建飞向屏幕中央的浮动卡片,动画结束后自动移除。
 * @param cardEl 手牌元素(动画起点,读取其 bounding rect)
 * @param card   卡牌数据(显示名称/花色)
 */
export function createCardFlyAnimation(cardEl: HTMLElement, card: Card): void {
  const rect = cardEl.getBoundingClientRect();
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2 - CENTER_Y_OFFSET;
  spawnFlyContainer({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    dx: cx - rect.left - rect.width / 2,
    dy: cy - rect.top - rect.height / 2,
    zIndex: 9999,
    animationName: 'flyToCenter',
    durationMs: FLY_DURATION_MS,
    extraCss: `border: 2px solid ${FLY_BORDER}; border-radius: 8px; padding: 10px 14px; background: ${FLY_BG}; color: ${FLY_TEXT}; text-align: center; box-shadow: ${FLY_SHADOW};`,
    children: createFaceLines(card, FACE_NAME_CSS, FACE_SUIT_CSS),
  });
}
