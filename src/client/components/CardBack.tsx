// src/client/components/CardBack.tsx
// 卡牌牌背渲染:优先显示牌背图片(card/back 或本地 cards-ai/back.png),无则渲染内联 SVG 牌背。
//
// 与 CardFace 同模式:<object type="image/png" data={url}> 内放 SVG fallback,
// 浏览器在图片加载失败(404/无文件)时自动渲染内部 SVG,纯 HTML 声明式回退。
//
// SVG 牌背与 scripts/gen-card.ts 的 buildBackSvg 同设计语言:
// 米黄纸纹底 + 金色双层边框 + 中央朱砂印章 + 四角云纹章。
// viewBox 100×140(5:7 卡牌比例),preserveAspectRatio="none" 填满父容器。
//
// 父容器需设定 position:relative + 固定尺寸,本组件 inset:0 填满。

import { css } from '@linaria/core';
import { getCardBackImage } from '../assets/imageAssets';

/** 牌背图片 <object>(填满父容器)。 */
const backObject = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

/** 内联 SVG 牌背 fallback(填满父容器)。 */
const backSvg = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
`;

/** 渲染牌背图片或内联 SVG 牌背。父容器需 position:relative + 固定尺寸。 */
export function CardBack() {
  const url = getCardBackImage();
  const svg = (
    <svg className={backSvg} viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="cb-paper" width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill="#f5e6c8" />
          <circle cx="1" cy="2" r="0.4" fill="#e8d4a8" opacity="0.18" />
          <circle cx="3" cy="4" r="0.3" fill="#e8d4a8" opacity="0.12" />
        </pattern>
        <radialGradient id="cb-seal" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#8b1a1a" />
          <stop offset="1" stopColor="#5c0f0f" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100" height="140" fill="url(#cb-paper)" />
      {/* 双层边框:外细深褐 + 内金线 */}
      <rect x="1.5" y="1.5" width="97" height="137" fill="none" stroke="#6b4e1a" strokeWidth="1" />
      <rect x="7" y="7" width="86" height="126" fill="none" stroke="#a8842a" strokeWidth="1.2" />
      {/* 四角云纹章 */}
      {[
        [14, 14],
        [86, 14],
        [14, 126],
        [86, 126],
      ].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="4.5" fill="#f5e6c8" stroke="#a8842a" strokeWidth="0.7" />
          <circle cx={x} cy={y} r="3.2" fill="none" stroke="#6b4e1a" strokeWidth="0.4" />
        </g>
      ))}
      {/* 中央朱砂印章 */}
      <circle cx="50" cy="70" r="24" fill="url(#cb-seal)" stroke="#5c0f0f" strokeWidth="0.8" />
      <circle cx="50" cy="70" r="21" fill="none" stroke="#f5e6c8" strokeWidth="0.6" opacity="0.6" />
    </svg>
  );

  // 无 URL:直接内联 SVG(生产/无图环境)。
  if (!url) return svg;

  return (
    <object className={backObject} data={url} type="image/png" aria-label="牌背">
      {svg}
    </object>
  );
}
