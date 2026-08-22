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
// 弧形排列容器:其他玩家沿上半部分弧线分布。
// 画布宽流式伸缩(1280~2240),超宽屏时座位环限宽居中,避免弧线过度拉伸走形
// (座位定位为容器百分比,限宽即限弧);中央装饰/操作坞仍按整个战场区铺开。
export const seatArcContainer = css`
  position: relative;
  width: 100%;
  max-width: 1760px;
  margin: 0 auto;
  height: 100%;
  overflow: visible;
`;
// 弧形中每个座位槽位:用 absolute 精确定位
export const seatArcSlot = css`
  position: absolute;
  left: var(--seat-left, 0);
  top: var(--seat-top, 0);
  transform: translateX(-50%);
  /* 宽度 = 武将卡高度 × 15/19,与大卡/座位卡同尺寸;内部 CountdownBar 与卡对齐 */
  width: calc(var(--hero-card-h) * 15 / 19);
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
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #cbbd93;
  background: linear-gradient(rgba(34, 28, 16, 0.85), rgba(22, 18, 10, 0.85));
  border: 1px solid rgba(200, 164, 78, 0.32);
  border-radius: 999px;
  padding: 4px 14px;
  letter-spacing: 0.5px;
  box-shadow:
    inset 0 1px 0 rgba(255, 235, 180, 0.07),
    0 2px 10px rgba(0, 0, 0, 0.45);
`;
/** 牌堆/弃牌堆图标:小卡背 */
export const zoneIcon = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 26px;
  font-size: 15px;
  line-height: 1;
  color: #d8c48a;
  background: linear-gradient(160deg, #3a2f52, #241d38);
  border: 1px solid rgba(200, 164, 78, 0.5);
  border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
`;
/** 区块计数数字 */
export const zoneCount = css`
  color: #f0dfae;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
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
// 连环徽章:铁灰底 + 铁链图标,标示横置(铁索连环)状态。与 PlayerSeatView 本地 chainBadge 视觉一致
export const chainBadge = css`
  display: inline-block;
  background: linear-gradient(135deg, #6b8294, #9bb3c4);
  border: 1px solid #b9cdd9;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 11px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
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
// 弃牌堆:小卡背图标 + 计数(与牌堆药丸同语言,红色系区分)
export const discardPileRow = css`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 2px;
  font-size: 12px;
  color: #c9a49b;
  background: linear-gradient(rgba(34, 20, 16, 0.85), rgba(24, 14, 10, 0.85));
  border: 1px solid rgba(231, 76, 60, 0.35);
  border-radius: 999px;
  padding: 3px 12px;
  letter-spacing: 0.5px;
  box-shadow:
    inset 0 1px 0 rgba(255, 200, 180, 0.05),
    0 2px 10px rgba(0, 0, 0, 0.45);
`;
export const discardPileIcon = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 26px;
  font-size: 13px;
  line-height: 1;
  color: #e8a08f;
  background: linear-gradient(160deg, #4a2622, #301815);
  border: 1px solid rgba(231, 76, 60, 0.5);
  border-radius: 3px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
`;
export const discardPileCount = css`
  color: #f2c4b8;
  font-weight: bold;
  font-variant-numeric: tabular-nums;
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
export const hpHealFlash = css`
  animation: healFlash 0.6s ease-out both;
`;
/* 体力变化漂浮数字(大卡):伤害「-N」红 / 回血「+N」绿,上浮渐隐 1s(与 useAnimationState 清除时序对齐) */
export const hpFloatNumber = css`
  position: absolute;
  left: 50%;
  top: 32%;
  z-index: 6;
  font-size: 34px;
  font-weight: 700;
  pointer-events: none;
  animation: hpFloatUp 1s ease-out both;
`;
export const hpFloatDamage = css`
  color: #ff4d4f;
  text-shadow: 0 0 8px rgba(255, 34, 34, 0.7), 0 1px 3px rgba(0, 0, 0, 0.9);
`;
export const hpFloatHeal = css`
  color: #52c41a;
  text-shadow: 0 0 8px rgba(82, 196, 26, 0.7), 0 1px 3px rgba(0, 0, 0, 0.9);
`;
export const seatHealOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    pointer-events: none;
    animation: healOverlay 0.6s ease-out both;
  }
  position: relative;
`;
export const phaseAnimating = css`
  animation: phaseIn 0.35s ease-out both;
`;
export const turnGlowing = css`
  animation: newTurnGlow 0.8s ease-out both;
`;
