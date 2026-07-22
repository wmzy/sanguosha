// 手牌区样式:手牌列表/卡牌变体(选中/禁用/可回应/转化/distribute) + 翻牌动效 + 卡牌通用文案。

import { css } from '@linaria/core';

// ─── Hand cards ───
export const handHeader = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;
export const handTitle = css`
  font-size: 14px;
  color: #aaa;
  font-weight: bold;
`;
export const debugHint = css`
  color: #666;
  font-weight: normal;
  font-size: 12px;
`;

// ─── Event card flip(翻牌动效,非阻塞) ───
// 铺满 battleField,卡片落在几何中心(与 centerTable / ActionOverlay 对齐)
export const eventCardLayer = css`
  position: absolute;
  inset: 0;
  z-index: 7;
  pointer-events: none;
  display: flex;
  justify-content: center;
  align-items: center;
`;
export const eventCardFlip = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  perspective: 800px;
  animation: cardFlipIn var(--flip-duration, 1800ms) cubic-bezier(0.22, 0.61, 0.36, 1) both;
`;
export const eventCardLabel = css`
  font-size: 11px;
  font-weight: bold;
  color: #b78bff;
  background: rgba(155, 89, 182, 0.2);
  padding: 1px 8px;
  border-radius: 8px;
  border: 1px solid rgba(155, 89, 182, 0.4);
`;
export const eventCardPlayer = css`
  font-size: 12px;
  font-weight: bold;
  color: #6fc3ff;
  background: rgba(52, 152, 219, 0.18);
  padding: 1px 10px;
  border-radius: 8px;
  border: 1px solid rgba(52, 152, 219, 0.4);
`;
export const eventCardBody = css`
  position: relative;
  box-sizing: border-box;
  min-width: 90px;
  width: 120px;
  height: 160px;
  padding: 0;
  border-radius: 8px;
  background: linear-gradient(135deg, #2a2a3e 0%, #1a1a2e 100%);
  border: 2px solid #c9a227;
  box-shadow: 0 4px 20px rgba(201, 162, 39, 0.4);
  text-align: center;
  transform-style: preserve-3d;
  overflow: hidden;
`;
// 翻牌动效卡牌插画作背景:失败隐藏,保留文字回退
export const eventCardArt = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  z-index: 0;
`;
// 文字内容层:底部渐变蒙版
export const eventCardMeta = css`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px 8px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.85) 0%,
    rgba(0, 0, 0, 0.55) 60%,
    rgba(0, 0, 0, 0) 100%
  );
`;
export const eventCardName = css`
  font-size: 16px;
  font-weight: bold;
  line-height: 1.3;
  color: var(--suit-color, #ccc);
`;
export const eventCardSuit = css`
  font-size: 13px;
  font-weight: bold;
  margin-top: 2px;
  color: var(--suit-color, #ccc);
`;
export const cancelBtn = css`
  border: 1px solid #555;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  background: transparent;
  color: #aaa;
  font-size: 11px;
`;
export const handList = css`
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 0;
  margin-bottom: 8px;
  min-height: 120px;
  padding: 8px 0 0;
`;
export const handCard = css`
  position: relative;
  box-sizing: border-box;
  border: 2px solid #555;
  border-radius: 8px;
  padding: 0;
  cursor: pointer;
  background: linear-gradient(180deg, rgba(30, 20, 15, 0.95) 0%, rgba(20, 12, 8, 0.95) 100%);
  min-width: 80px;
  width: 80px;
  /* 固定高度:文字层绝对定位,不再被插画撑高 */
  height: 120px;
  text-align: center;
  transition: all 0.2s;
  transform: rotate(var(--fan-angle, 0deg));
  transform-origin: bottom center;
  z-index: var(--card-z, 0);
  box-shadow: -1px 2px 6px rgba(0, 0, 0, 0.3);
  margin-left: -16px;
  overflow: hidden;
  &:first-of-type {
    margin-left: 0;
  }
  &:hover {
    z-index: 100 !important;
    margin-bottom: 8px;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
    border-color: #888;
  }
`;
// 手牌牌面插画作背景:绝对定位填满卡牌,失败隐藏保留文字回退
export const handCardArt = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  z-index: 0;
`;
// 手牌文字层:底部渐变蒙版覆盖,不撑高卡牌
export const handCardMeta = css`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 14px 4px 6px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.82) 0%,
    rgba(0, 0, 0, 0.55) 60%,
    rgba(0, 0, 0, 0) 100%
  );
`;
export const handCardSelected = css`
  border: 2px solid #3498db;
  background: rgba(52, 152, 219, 0.18);
  margin-bottom: 8px;
  box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
`;
export const handCardDisabled = css`
  opacity: 0.4;
  cursor: default;
`;
export const handCardRespondable = css`
  border: 2px solid #ffd700;
  box-shadow: 0 0 10px rgba(255, 215, 0, 0.4);
  background: rgba(255, 215, 0, 0.08);
`;
// 转化模式:匹配卡牌用金色高亮表示可作为“转化后的牌”点选
export const handCardTransform = css`
  border: 2px solid #f1c40f;
  box-shadow: 0 0 10px rgba(241, 196, 15, 0.5);
  background: rgba(241, 196, 15, 0.08);
  cursor: pointer;
  &:hover {
    background: rgba(241, 196, 15, 0.18);
  }
`;
// 转化模式:不匹配卡牌变灰、不可点
export const handCardTransformDisabled = css`
  opacity: 0.3;
  cursor: not-allowed;
`;
// distribute(仁德/制衡/遗计):候选可分配牌金色高亮
export const handCardDistributeCandidate = css`
  border: 2px solid #f1c40f;
  box-shadow: 0 0 10px rgba(241, 196, 15, 0.4);
  cursor: pointer;
  &:hover {
    background: rgba(241, 196, 15, 0.15);
  }
`;
// distribute:已选中牌(待分配/待提交)绿色加粗边框
export const handCardDistributeSelected = css`
  border: 2px solid #2ecc71;
  box-shadow: 0 0 12px rgba(46, 204, 113, 0.5);
  background: rgba(46, 204, 113, 0.15);
  margin-bottom: 8px;
`;
// distribute:已分配给目标(allocate 模式)半透明、不可再点
export const handCardDistributeAllocated = css`
  opacity: 0.4;
  cursor: default;
  border-color: #888;
`;
export const discardCardSelected = css`
  opacity: 0.5;
  border: 2px solid #e74c3c;
  border-radius: 6px;
  background: rgba(231, 76, 60, 0.18);
`;
export const cardName = css`
  font-weight: bold;
  font-size: 16px;
  letter-spacing: 1px;
  color: var(--suit-color, #ccc);
`;
export const cardSuit = css`
  font-size: 13px;
  color: var(--suit-color, #ccc);
`;
export const cardOrigin = css`
  font-size: 10px;
  opacity: 0.7;
  font-style: italic;
  color: var(--suit-color, #ccc);
`;
export const emptyHand = css`
  color: #555;
  font-size: 13px;
  padding: 12px;
`;

// ─── distribute 外部候选区(牌堆顶/目标牌等不在手牌区的候选)───
// 触发场景:观星/界观星/界恂恂/界称象(牌堆顶牌)、界破军/界镇军(目标的牌)。
// 这些牌不在操作者手牌/装备区,手牌区的 distribute 候选高亮逻辑无法覆盖,
// 故单独渲染为独立候选排。牌内容通过 view.cardMap 查得。
export const distExternalWrap = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin: 4px 0 4px;
  padding: 6px 8px;
  border: 1px dashed rgba(241, 196, 15, 0.3);
  border-radius: 6px;
  background: rgba(241, 196, 15, 0.04);
`;
export const distExternalLabel = css`
  color: #f1c40f;
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 0.5px;
`;
export const distExternalList = css`
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 4px;
  min-height: 80px;
`;
// 外部候选卡片:基于 handCard 样式,但去掉扇形旋转和负 margin(独立横排)
export const distExternalCard = css`
  border: 2px solid #555;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  background: linear-gradient(180deg, rgba(30, 20, 15, 0.95) 0%, rgba(20, 12, 8, 0.95) 100%);
  min-width: 64px;
  width: 72px;
  text-align: center;
  transition: all 0.2s;
  &:hover {
    border-color: #888;
    transform: translateY(-2px);
  }
`;
