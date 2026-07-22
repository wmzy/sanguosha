// 座位区样式:弧形排列 + 武将卡(势力色 header/体力/技能标签) + 各区域行 + 动画状态。

import { css } from '@linaria/core';

// ─── Seating — arc layout ───
// 占满 battleField,座位环绕中央,中央留出处理区位置
export const seatingArea = css`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
`;
// 弧形排列容器:其他玩家沿上半部分弧线分布
export const seatArcContainer = css`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: visible;
`;
// 弧形中每个座位槽位:用 absolute 精确定位
export const seatArcSlot = css`
  position: absolute;
  left: var(--seat-left, 0);
  top: var(--seat-top, 0);
  transform: translateX(-50%);
  /* 竖向座位卡宽度;内部 CountdownBar 与卡对齐 */
  width: 148px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  z-index: 2;
`;
/** @deprecated 定位已迁至 layout.centerTable;保留别名以免外部引用断裂 */
export const centerMeta = css`
  text-align: center;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`;
export const metaText = css`
  font-size: 12px;
  color: #888;
`;

// ─── Seat card — 竖向信息卡(无立绘):势力色 header + HP + 技能 ───
export const seatCard = css`
  border: 1px solid #444;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.55);
  transition: all 0.25s;
  width: 148px;
  min-height: 168px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
`;
// 势力色顶部条:武将名 + 身份
export const seatCardHeader = css`
  padding: 5px 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;
export const seatCardHeaderTop = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
`;
export const seatCharName = css`
  font-weight: bold;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
`;
// 体力行:红心表示 HP
export const seatHpRow = css`
  display: flex;
  gap: 2px;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.3);
`;
export const hpHeartFull = css`
  color: #e74c3c;
  font-size: 16px;
  text-shadow: 0 0 4px rgba(231, 76, 60, 0.5);
`;
export const hpHeartEmpty = css`
  color: #555;
  font-size: 14px;
`;
export const seatCardActive = css`
  box-shadow:
    0 0 18px rgba(255, 215, 0, 0.35),
    inset 0 0 8px rgba(255, 215, 0, 0.1);
  outline: 2px solid #ffd700;
`;
export const seatCardPerspective = css`
  border: 2px solid #3498db;
  box-shadow: 0 0 8px rgba(52, 152, 219, 0.25);
`;
export const seatCardDead = css`
  opacity: 0.35;
  filter: grayscale(1);
`;
export const seatCardClickable = css`
  cursor: pointer;
  &:hover {
    outline: 2px solid #e74c3c;
  }
`;
export const seatCardTargeted = css`
  outline: 3px solid #e74c3c;
  box-shadow: 0 0 12px rgba(231, 76, 60, 0.4);
`;
export const seatHeader = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
export const seatName = css`
  font-weight: bold;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
`;
export const seatIndexBadge = css`
  display: inline-block;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.6);
  border-radius: 3px;
  padding: 1px 5px;
  margin-right: 4px;
  font-size: 10px;
  font-weight: normal;
  vertical-align: middle;
`;
export const seatChar = css`
  color: #8899aa;
  font-size: 12px;
  margin-left: 4px;
`;
export const youBadge = css`
  background: #3498db;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 9px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
`;
export const turnBadge = css`
  background: #ffd700;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 9px;
  color: #000;
  margin-left: 4px;
  font-weight: bold;
`;
export const lordBadge = css`
  background: #ffd700;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 9px;
  color: #4a2800;
  margin-left: 4px;
  font-weight: bold;
`;
export const loyalistBadge = css`
  background: #4a90e2;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 9px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
`;
export const rebelBadge = css`
  background: #e74c3c;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 9px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
`;
export const renegadeBadge = css`
  background: #9b59b6;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 9px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
`;
export const hiddenBadge = css`
  background: #555;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  color: #bbb;
  margin-left: 4px;
  font-weight: bold;
`;
export const hpFull = css`
  color: #2ecc71;
  font-weight: bold;
  font-size: 13px;
`;
export const hpMid = css`
  color: #e67e22;
  font-weight: bold;
  font-size: 13px;
`;
export const hpLow = css`
  color: #e74c3c;
  font-weight: bold;
  font-size: 13px;
`;
export const equipRow = css`
  font-size: 11px;
  color: #f39c12;
  padding: 0 10px 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;
// 判定区(延时锦囊):斜体、紫色边框,亮眼能看清
export const judgeRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 11px;
`;
export const judgeRowLabel = css`
  color: #b78bff;
  font-weight: bold;
`;
export const judgeTag = css`
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--suit-color, #ccc);
  color: var(--suit-color, #ccc);
  background: rgba(155, 89, 182, 0.12);
  font-weight: bold;
`;
// 处理区:游戏中央的一排小卡
export const processingRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 6px auto;
  padding: 6px 12px;
  background: rgba(231, 126, 34, 0.14);
  border: 1px dashed #e67e22;
  border-radius: 8px;
  max-width: 480px;
  font-size: 12px;
  justify-content: center;
  box-shadow: 0 2px 12px rgba(230, 126, 34, 0.2);
`;
export const processingLabel = css`
  color: #e67e22;
  font-weight: bold;
`;
export const processingTag = css`
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--suit-color, #ccc);
  color: var(--suit-color, #ccc);
  background: rgba(230, 126, 34, 0.08);
  font-weight: bold;
`;
// 处理区牌上的使用者名(小号白字,前面带·分隔)
export const processingOwner = css`
  color: #f1c40f;
  font-size: 10px;
  margin-right: 4px;
  font-weight: normal;
`;
export const processingCardName = css`
  margin-right: 2px;
`;
export const processingSuit = css`
  font-size: 10px;
  opacity: 0.85;
`;
// 弃牌堆:小图标 + 计数
export const discardPileRow = css`
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
  margin-top: 4px;
  font-size: 12px;
  color: #aaa;
`;
export const discardPileIcon = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: rgba(231, 76, 60, 0.18);
  border: 1px solid #e74c3c;
  border-radius: 4px;
  font-size: 14px;
`;
export const discardPileCount = css`
  color: #e0e0e0;
  font-weight: bold;
`;
export const skillRow = css`
  margin-bottom: 4px;
`;
export const skillTag = css`
  display: inline-block;
  background: rgba(15, 52, 96, 0.6);
  border-radius: 3px;
  padding: 1px 5px;
  margin-right: 3px;
  font-size: 10px;
  color: #8899aa;
`;
export const infoRow = css`
  font-size: 11px;
  color: #999;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 10px 4px;
`;
export const markRow = css`
  font-size: 10px;
  color: #666;
  padding: 0 10px 4px;
`;
export const markTag = css`
  margin-right: 6px;
`;

// ─── 动画状态样式 ───
export const hpFlash = css`
  animation: damageFlash 0.6s ease-out both;
`;
export const seatShaking = css`
  animation: damageShake 0.5s ease-out both;
`;
export const seatDamageOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    pointer-events: none;
    animation: damageOverlay 0.6s ease-out both;
  }
  position: relative;
`;
export const phaseAnimating = css`
  animation: phaseIn 0.35s ease-out both;
`;
export const turnGlowing = css`
  animation: newTurnGlow 0.8s ease-out both;
`;
