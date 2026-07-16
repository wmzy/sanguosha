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
// 中央浮动卡牌:从上方弹出 + 3D 翻转揭示花色点数
export const eventCardLayer = css`
  pointer-events: none;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 0;
  margin: 0;
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
  min-width: 60px;
  padding: 8px 12px;
  border-radius: 8px;
  background: linear-gradient(135deg, #2a2a3e 0%, #1a1a2e 100%);
  border: 2px solid #c9a227;
  box-shadow: 0 4px 20px rgba(201, 162, 39, 0.4);
  text-align: center;
  transform-style: preserve-3d;
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
  border: 2px solid #555;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  background: linear-gradient(180deg, rgba(30, 20, 15, 0.95) 0%, rgba(20, 12, 8, 0.95) 100%);
  min-width: 72px;
  width: 80px;
  text-align: center;
  transition: all 0.2s;
  transform: rotate(var(--fan-angle, 0deg));
  transform-origin: bottom center;
  z-index: var(--card-z, 0);
  box-shadow: -1px 2px 6px rgba(0, 0, 0, 0.3);
  margin-left: -16px;
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
  margin-bottom: 2px;
  letter-spacing: 1px;
  color: var(--suit-color, #ccc);
`;
export const cardSuit = css`
  font-size: 13px;
  margin-top: 2px;
  color: var(--suit-color, #ccc);
`;
export const cardOrigin = css`
  font-size: 10px;
  opacity: 0.7;
  margin-bottom: 2px;
  font-style: italic;
  color: var(--suit-color, #ccc);
`;
export const emptyHand = css`
  color: #555;
  font-size: 13px;
  padding: 12px;
`;
