// src/client/components/CardFace.tsx
// 卡牌牌面渲染:优先显示 cards-local 图片,404 时 fallback 到 HTML 绘制牌面。
//
// 实现方式:<object type="image/png" data={url}> 内部放 HTML fallback。
// 浏览器在 object 加载失败(404/网络错误)时自动渲染其内部子元素,
// 无需 JS onError 交换 src,是纯 HTML 的声明式 fallback 机制。
//
// HTML fallback 用 CSS 绘制一张简化牌面:花色点数(左上) + 牌名(底部),
// 视觉与图片版手牌一致(深色背景 + 渐变文字层)。

import { css } from '@linaria/core';
import { SUIT_COLOR } from './gameViewConstants';
import { getCardImage } from '../assets/imageAssets';
import { displayCardName } from '../utils/gameViewHelpers';

export type CardFaceSize = 'normal' | 'large' | 'small';

/** 渲染卡牌图片或 HTML fallback 牌面。
 *
 * - 有 card 图片(cards-local): <object> 显示图片,占满父容器。
 * - 无图片(getCardImage 返回 null): 直接渲染 HTML 牌面。
 * - 图片 404: <object> 自动 fallback 到内部 HTML 牌面。
 *
 * 父容器需设定 position:relative + 固定尺寸,本组件 inset:0 填满。 */
export function CardFace({
  name,
  suit,
  rank,
  size = 'normal',
  damageType,
}: {
  name: string;
  suit?: string;
  rank?: string;
  size?: CardFaceSize;
  /** 伤害属性(火焰/雷电):用于 HTML fallback 显示「火杀」「雷杀」;
   *  图片 URL 仍用原始 name('杀')因资源按内部牌名索引。 */
  damageType?: string;
}) {
  const url = getCardImage({ name, suit, rank });
  const color = SUIT_COLOR[suit ?? ''] ?? '#ccc';
  const sz = size;
  const display = displayCardName(name, damageType);

  const fallback = (
    <div
      className={`${cardFallback} ${sz === 'small' ? nameSmall : sz === 'large' ? nameLarge : nameNormal}`}
      style={{ '--suit-color': color } as React.CSSProperties}
    >
      <div className={`${corner} ${sz === 'small' ? cornerSmall : sz === 'large' ? cornerLarge : cornerNormal}`}>
        <span className={rankCls}>{rank}</span>
        {/* 红色牌(♥♦)双重编码:符号底部横杠承载类别信息,不依赖红绿分辨 */}
        <span className={`${suitCls} ${suit === '♥' || suit === '♦' ? redSuitCls : ''}`}>{suit}</span>
      </div>
      <div className={cardName}>{display}</div>
    </div>
  );

  // 无 URL(转化卡/信息不全):直接 HTML 牌面,不包 <object>。
  if (!url) return fallback;

  return (
    <object
      className={cardObject}
      data={url}
      aria-label={`${display} ${suit}${rank}`}
    >
      {/* object 加载失败时浏览器渲染此 fallback */}
      {fallback}
    </object>
  );
}

// <object> 填满父容器,图片覆盖显示
const cardObject = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  z-index: 0;
  border: none;
  padding: 0;
  margin: 0;
  display: block;
`;

// HTML fallback 牌面:填满父容器,深色背景模拟卡牌
const cardFallback = css`
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: linear-gradient(180deg, rgba(30, 20, 15, 0.95) 0%, rgba(20, 12, 8, 0.95) 100%);
`;

// 底部牌名(与图片版手牌文字层一致的渐变蒙版)
const cardName = css`
  text-align: center;
  font-weight: bold;
  letter-spacing: 1px;
  color: var(--suit-color, #ccc);
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.82) 0%,
    rgba(0, 0, 0, 0.55) 60%,
    rgba(0, 0, 0, 0) 100%
  );
`;

// 左上角花色点数
const corner = css`
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
  color: var(--suit-color, #ccc);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
`;
const rankCls = css`
  font-weight: bold;
`;
const suitCls = css``;

// 红色牌类别标记:花色符号底部一条横杠(沿用 currentColor 即花色红),
// 形状本身携带「红色牌」类别,色弱玩家无需依赖红绿分辨;黑色牌不加。
// corner 为绝对定位于左上角的纵向排列,横杠向下生长不会溢出牌面。
const redSuitCls = css`
  border-bottom: 2px solid currentColor;
  padding-bottom: 1px;
`;

// normal(手牌 80×120)
const nameNormal = css`
  & > div:last-child {
    font-size: 16px;
    padding: 14px 4px 6px;
  }
`;
const cornerNormal = css``;

// large(翻牌动效)
const nameLarge = css`
  & > div:last-child {
    font-size: 22px;
    padding: 20px 12px 10px;
  }
`;
const cornerLarge = css`
  top: 8px;
  left: 8px;
  & > span {
    font-size: 20px;
  }
  & > span:last-child {
    font-size: 18px;
  }
`;

// small(历史条 60×80)
const nameSmall = css`
  & > div:last-child {
    font-size: 13px;
    padding: 12px 4px 4px;
  }
`;
const cornerSmall = css`
  top: 3px;
  left: 3px;
  & > span {
    font-size: 11px;
  }
  & > span:last-child {
    font-size: 10px;
  }
`;
