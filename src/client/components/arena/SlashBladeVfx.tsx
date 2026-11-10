import React from 'react';

export interface SlashBladeVfxProps {
  onAnimationEnd?: () => void;
  className?: string;
}

/**
 * 水墨金色月牙刀光动效 (SlashBladeVfx)
 * 在受击角色头像上播放一道水墨金色刀光划过动效。
 */
export function SlashBladeVfx({ onAnimationEnd, className }: SlashBladeVfxProps) {
  return (
    <div
      className={`arena-slash-blade ${className ?? ''}`}
      data-testid="slash-blade-vfx"
      onAnimationEnd={onAnimationEnd}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 120 120"
        className="arena-slash-svg"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="arena-blade-gold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="25%" stopColor="#ffe685" stopOpacity="1" />
            <stop offset="60%" stopColor="#d4af37" stopOpacity="0.9" />
            <stop offset="90%" stopColor="#8a6d1c" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#3d2c0b" stopOpacity="0" />
          </linearGradient>
          <filter id="arena-blade-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* 外层水墨阴影拖尾 */}
        <path
          d="M 10 110 Q 55 58 110 10 Q 72 45 35 80 Z"
          fill="#111714"
          opacity="0.6"
          transform="translate(2, 2)"
        />
        {/* 金色月牙主刀光 */}
        <path
          d="M 12 108 Q 58 55 108 12 Q 70 42 30 75 Z"
          fill="url(#arena-blade-gold)"
          filter="url(#arena-blade-glow)"
          className="arena-slash-path"
        />
        {/* 内部极速锐利白金刀刃核心线 */}
        <path
          d="M 22 96 Q 60 58 98 22"
          stroke="#fffdf0"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="arena-slash-core"
        />
      </svg>
    </div>
  );
}
