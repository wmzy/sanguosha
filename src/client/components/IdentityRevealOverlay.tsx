// src/client/components/IdentityRevealOverlay.tsx
// 身份揭示遮罩:开局亮明身份(主公金/忠臣蓝/反贼红/内奸紫),翻牌动画 + 确认按钮。
// 从 GameView.tsx 抽出,组件自包含样式,纯 props 控制。

import { css } from '@linaria/core';
import { IDENTITY_COLORS } from './gameViewConstants';

interface IdentityRevealOverlayProps {
  /** 当前 viewer 的身份(主公/忠臣/反贼/内奸) */
  identity: string;
  /** 玩家点击确认后的回调(隐藏遮罩 + 写 sessionStorage 由调用方决定) */
  onConfirm: () => void;
}

/**
 * 身份揭示遮罩。开局时弹出一张身份牌,玩家点击「确认」后消失。
 * - zIndex 高于选将遮罩(10000 vs 9999),先入后出;
 * - 翻牌 + 渐入动画在 animations.css 中定义(`identityCardFlip`/`overlayFadeIn`)。
 */
export function IdentityRevealOverlay({ identity, onConfirm }: IdentityRevealOverlayProps) {
  const color = IDENTITY_COLORS[identity] || '#888';
  return (
    <div className={overlayRoot}>
      <div className={identityCard} style={{ '--identity-color': color } as React.CSSProperties}>
        <div className={identityLabel}>你的身份</div>
        <div className={identityName}>{identity}</div>
      </div>
      <button className={confirmBtn} onClick={onConfirm}>
        确认
      </button>
    </div>
  );
}

/* ── 样式定义 ── */

/** 全屏遮罩根节点:固定定位 + 黑色半透明 + 渐入动画 */
const overlayRoot = css`
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  animation: overlayFadeIn 0.5s ease-out both;
`;

/** 身份卡片:200×280,圆角12,翻牌动画,背景色由 CSS 变量控制 */
const identityCard = css`
  width: 200px;
  height: 280px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--identity-color);
  color: #fff;
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.5);
  animation: identityCardFlip 1s cubic-bezier(0.23, 1, 0.32, 1) both;
  transform-style: preserve-3d;
`;

/** 「你的身份」小标签 */
const identityLabel = css`
  font-size: 14px;
  opacity: 0.8;
  letter-spacing: 2px;
`;

/** 身份名称(大号加粗 + 文字阴影) */
const identityName = css`
  font-size: 36px;
  font-weight: bold;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
`;

/** 确认按钮:半透明边框 + hover 高亮 */
const confirmBtn = css`
  margin-top: 32px;
  padding: 10px 48px;
  font-size: 16px;
  font-weight: bold;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }
`;
