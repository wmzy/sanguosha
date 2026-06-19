// src/client/components/IdentityRevealOverlay.tsx
// 身份揭示遮罩:开局亮明身份(主公金/忠臣蓝/反贼红/内奸紫),翻牌动画 + 确认按钮。
// 从 GameView.tsx 抽出,组件自包含样式,纯 props 控制。

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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.85)',
        animation: 'overlayFadeIn 0.5s ease-out both',
      }}
    >
      <div
        style={{
          width: 200,
          height: 280,
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: color,
          color: '#fff',
          boxShadow: '0 0 40px rgba(0, 0, 0, 0.5)',
          animation: 'identityCardFlip 1s cubic-bezier(0.23, 1, 0.32, 1) both',
          transformStyle: 'preserve-3d',
        }}
      >
        <div style={{ fontSize: 14, opacity: 0.8, letterSpacing: 2 }}>你的身份</div>
        <div style={{ fontSize: 36, fontWeight: 'bold', textShadow: '0 2px 8px rgba(0, 0, 0, 0.3)' }}>{identity}</div>
      </div>
      <button
        onClick={onConfirm}
        style={{
          marginTop: 32,
          padding: '10px 48px',
          fontSize: 16,
          fontWeight: 'bold',
          color: '#fff',
          background: 'rgba(255, 255, 255, 0.15)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)')}
      >
        确认
      </button>
    </div>
  );
}