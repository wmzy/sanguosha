// src/client/utils/cardFlyAnimation.ts
// 出牌飞行动画:手牌消失前在原位生成一个浮动卡片元素,飞向屏幕中央后移除。
// 从 GameView.tsx 抽出,所有样式常量集中于此(消除组件内的 DOM/颜色 hardcode)。
// keyframes `flyToCenter` 定义在 src/client/animations.css(全局)。

import type { Card } from '../../engine/types';
import { SUIT_COLOR } from '../components/gameViewConstants';

// ─── 飞行卡片视觉常量 ───
const FLY_BORDER = '#3498db';
const FLY_BG = 'rgba(22,33,62,0.95)';
const FLY_TEXT = '#e0e0e0';
const FLY_SHADOW = '0 0 16px rgba(52,152,219,0.6)';
const FLY_ANIMATION = 'flyToCenter 0.45s cubic-bezier(0.4, 0, 0.2, 1) forwards';
// 中央落点偏移(略高于屏幕正中)
const CENTER_Y_OFFSET = 40;

/**
 * 在给定 DOM 元素位置创建飞向屏幕中央的浮动卡片,动画结束后自动移除。
 * @param cardEl 手牌元素(动画起点,读取其 bounding rect)
 * @param card   卡牌数据(显示名称/花色)
 */
export function createCardFlyAnimation(cardEl: HTMLElement, card: Card): void {
  const rect = cardEl.getBoundingClientRect();
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2 - CENTER_Y_OFFSET;
  const flyDx = cx - rect.left - rect.width / 2;
  const flyDy = cy - rect.top - rect.height / 2;
  const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';

  const floating = document.createElement('div');
  floating.style.cssText = `
    position: fixed; left: ${rect.left}px; top: ${rect.top}px;
    width: ${rect.width}px; height: ${rect.height}px;
    border: 2px solid ${FLY_BORDER}; border-radius: 8px; padding: 10px 14px;
    background: ${FLY_BG}; color: ${FLY_TEXT};
    text-align: center; pointer-events: none; z-index: 9999;
    --fly-dx: ${flyDx}px; --fly-dy: ${flyDy}px;
    animation: ${FLY_ANIMATION};
    box-shadow: ${FLY_SHADOW};
  `;

  const nameDiv = document.createElement('div');
  nameDiv.style.cssText = `font-weight: bold; font-size: 15px; margin-bottom: 2px; color: ${suitColor};`;
  nameDiv.textContent = card.name;

  const suitDiv = document.createElement('div');
  suitDiv.style.cssText = `font-size: 12px; color: ${suitColor};`;
  suitDiv.textContent = `${card.suit}${card.rank}`;

  floating.appendChild(nameDiv);
  floating.appendChild(suitDiv);
  document.body.appendChild(floating);
  floating.addEventListener('animationend', () => floating.remove());
}
