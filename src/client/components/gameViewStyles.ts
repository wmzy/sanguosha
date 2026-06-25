// src/client/components/gameViewStyles.ts
// GameView 全部样式定义,从 GameView.tsx 抽离。
// 通过 `import * as styles from './gameViewStyles'` 使用:
//   className={styles.pageRoot}
//   className={cx(styles.seatCard, isActive && styles.seatCardActive)}
//
// 动画 keyframes (drawCardIn / damageFlash / damageShake / phaseIn / newTurnGlow / damageOverlay)
// 定义在 src/client/animations.css,由 main.tsx 全局引入。

import { css } from '@linaria/core';

// ─── 页面骨架 ───
export const pageRoot = css`
  padding: 12px;
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
  background: linear-gradient(180deg, #1a0f0a 0%, #2d1810 30%, #1e1008 70%, #0d0804 100%);
  color: #e0e0e0;
  min-height: 100vh;
  overflow-x: hidden;
`;

// ─── Header ───
export const headerBar = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(0,0,0,0.3);
  border-radius: 8px;
`;
export const backBtn = css`
  border: 1px solid #555; border-radius: 4px; padding: 4px 12px;
  cursor: pointer; background: transparent; color: #e0e0e0; font-size: 13px;
`;
export const headerCenter = css`display: flex; align-items: center; gap: 12px; font-size: 14px;`;
export const roundBadge = css`
  background: #0f3460; border-radius: 4px; padding: 2px 8px;
  font-size: 12px; color: #8899aa;
`;
export const phaseBadge = css`
  background: #e67e22; border-radius: 4px; padding: 2px 8px;
  font-size: 12px; color: #fff; font-weight: bold;
`;
export const currentPlayerText = css`color: #ffd700;`;
export const headerRight = css`display: flex; gap: 8px;`;
export const perspectiveBtn = css`
  border: 1px solid #3498db; border-radius: 4px; padding: 4px 10px;
  cursor: pointer; background: transparent; color: #3498db; font-size: 12px;
`;
export const goToBtn = css`
  border: 1px solid #555; border-radius: 4px; padding: 4px 10px;
  cursor: pointer; background: transparent; color: #aaa; font-size: 12px;
`;

// ─── Prompt ───
export const promptBox = css`
  border: 2px solid #e67e22; border-radius: 8px; padding: 12px 16px;
  background: rgba(230,126,34,0.15); margin-bottom: 12px;
`;
export const promptBoxAwaiting = css`
  border: 2px solid #e74c3c; border-left: 4px solid #e74c3c;
  border-radius: 8px; padding: 12px 16px;
  background: rgba(231,76,60,0.1); margin-bottom: 12px;
`;
export const promptTitle = css`color: #e67e22; font-weight: bold; font-size: 15px; margin-bottom: 4px;`;
export const promptDesc = css`font-size: 14px; margin-bottom: 8px;`;
export const promptActions = css`display: flex; gap: 8px; flex-wrap: wrap;`;
export const promptBtn = css`
  border: 1px solid #888; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(0,0,0,0.3); color: #e0e0e0; font-size: 13px;
`;
export const promptBtnPrimary = css`
  border: 1px solid #27ae60; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(39,174,96,0.2); color: #2ecc71; font-size: 13px; font-weight: bold;
`;
// 五谷丰登:被选走的牌(置暗禁用)
export const promptBtnDisabled = css`
  border: 1px solid #555; border-radius: 6px; padding: 6px 14px;
  cursor: not-allowed; background: rgba(40,40,40,0.5); color: #666; font-size: 13px;
  opacity: 0.6; display: inline-flex; flex-direction: column; align-items: center; gap: 2px;
`;
export const pickedByTag = css`
  font-size: 10px; color: #e74c3c; font-weight: normal;
  text-decoration: line-through;
`;

export const waitingHint = css`
  text-align: center; color: #888; font-size: 13px; margin-bottom: 12px;
`;

// ─── Seating — arc layout ───
export const seatingArea = css`
  position: relative;
  margin-bottom: 16px;
  min-height: 320px;
`;
// 弧形排列容器:其他玩家沿上半部分弧线分布
export const seatArcContainer = css`
  position: relative;
  width: 100%;
  height: 200px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  margin-bottom: 8px;
  overflow: visible;
`;
// 弧形中每个座位槽位:用 absolute 精确定位
export const seatArcSlot = css`
  position: absolute;
  transform: translateX(-50%);
  /* 给定宽度,使内部 CountdownBar 等子元素宽度与卡片对齐 */
  width: 180px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;
export const centerMeta = css`
  text-align: center;
  margin: 8px auto;
  max-width: 300px;
`;
export const metaText = css`font-size: 12px; color: #888;`;

// ─── Seat card — 武将卡风格:势力色 header + 体力红心 + 技能标签 ───
export const seatCard = css`
  border: 1px solid #444;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0,0,0,0.5);
  transition: all 0.25s;
  min-width: 170px;
  max-width: 200px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.3);
`;
// 势力色顶部条:武将名 + 身份
export const seatCardHeader = css`
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;
export const seatCardHeaderTop = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
export const seatCharName = css`
  font-weight: bold;
  font-size: 15px;
  color: rgba(255,255,255,0.9);
  text-shadow: 0 1px 3px rgba(0,0,0,0.4);
`;
// 体力行:红心表示 HP
export const seatHpRow = css`
  display: flex;
  gap: 2px;
  padding: 4px 10px;
  background: rgba(0,0,0,0.3);
`;
export const hpHeartFull = css`
  color: #e74c3c;
  font-size: 16px;
  text-shadow: 0 0 4px rgba(231,76,60,0.5);
`;
export const hpHeartEmpty = css`
  color: #555;
  font-size: 14px;
`;
export const seatCardActive = css`
  box-shadow: 0 0 18px rgba(255,215,0,0.35), inset 0 0 8px rgba(255,215,0,0.1);
  outline: 2px solid #ffd700;
`;
export const seatCardPerspective = css`
  border: 2px solid #3498db;
  box-shadow: 0 0 8px rgba(52,152,219,0.25);
`;
export const seatCardDead = css`opacity: 0.35; filter: grayscale(1);`;
export const seatCardClickable = css`cursor: pointer; &:hover { outline: 2px solid #e74c3c; }`;
export const seatCardTargeted = css`outline: 3px solid #e74c3c; box-shadow: 0 0 12px rgba(231,76,60,0.4);`;
export const seatHeader = css`
  display: flex; justify-content: space-between; align-items: center;
`;
export const seatName = css`font-weight: bold; font-size: 12px; color: rgba(255,255,255,0.85);`;
export const seatIndexBadge = css`
  display: inline-block;
  background: rgba(0,0,0,0.2);
  color: rgba(255,255,255,0.6);
  border-radius: 3px;
  padding: 1px 5px;
  margin-right: 4px;
  font-size: 10px;
  font-weight: normal;
  vertical-align: middle;
`;
export const seatChar = css`color: #8899aa; font-size: 12px; margin-left: 4px;`;
export const youBadge = css`
  background: #3498db; border-radius: 3px; padding: 1px 5px;
  font-size: 9px; color: #fff; margin-left: 4px; font-weight: bold;
`;
export const turnBadge = css`
  background: #ffd700; border-radius: 3px; padding: 1px 5px;
  font-size: 9px; color: #000; margin-left: 4px; font-weight: bold;
`;
export const lordBadge = css`
  background: #FFD700; border-radius: 3px; padding: 1px 6px;
  font-size: 9px; color: #4a2800; margin-left: 4px; font-weight: bold;
`;
export const loyalistBadge = css`
  background: #4A90E2; border-radius: 3px; padding: 1px 6px;
  font-size: 9px; color: #fff; margin-left: 4px; font-weight: bold;
`;
export const rebelBadge = css`
  background: #E74C3C; border-radius: 3px; padding: 1px 6px;
  font-size: 9px; color: #fff; margin-left: 4px; font-weight: bold;
`;
export const renegadeBadge = css`
  background: #9B59B6; border-radius: 3px; padding: 1px 6px;
  font-size: 9px; color: #fff; margin-left: 4px; font-weight: bold;
`;
export const hiddenBadge = css`
  background: #555; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #bbb; margin-left: 4px; font-weight: bold;
`;
export const hpFull = css`color: #2ecc71; font-weight: bold; font-size: 13px;`;
export const hpMid = css`color: #e67e22; font-weight: bold; font-size: 13px;`;
export const hpLow = css`color: #e74c3c; font-weight: bold; font-size: 13px;`;
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
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  margin-top: 2px; font-size: 11px;
`;
export const judgeRowLabel = css`color: #b78bff; font-weight: bold;`;
export const judgeTag = css`
  display: inline-block; padding: 1px 6px; border-radius: 4px;
  border: 1px solid; background: rgba(155, 89, 182, 0.12);
  font-weight: bold;
`;
// 处理区:游戏中央的一排小卡
export const processingRow = css`
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  margin: 6px auto; padding: 4px 8px;
  background: rgba(231, 126, 34, 0.12);
  border: 1px dashed #e67e22;
  border-radius: 6px;
  max-width: 240px;
  font-size: 11px;
  justify-content: center;
`;
export const processingLabel = css`color: #e67e22; font-weight: bold;`;
export const processingTag = css`
  display: inline-block; padding: 1px 6px; border-radius: 4px;
  border: 1px solid; background: rgba(230, 126, 34, 0.08);
  font-weight: bold;
`;
// 弃牌堆:小图标 + 计数
export const discardPileRow = css`
  display: flex; align-items: center; gap: 4px;
  justify-content: center;
  margin-top: 4px;
  font-size: 12px;
  color: #aaa;
`;
export const discardPileIcon = css`
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  background: rgba(231, 76, 60, 0.18);
  border: 1px solid #e74c3c;
  border-radius: 4px;
  font-size: 14px;
`;
export const discardPileCount = css`color: #e0e0e0; font-weight: bold;`;
export const skillRow = css`margin-bottom: 4px;`;
export const skillTag = css`
  display: inline-block; background: rgba(15,52,96,0.6); border-radius: 3px;
  padding: 1px 5px; margin-right: 3px; font-size: 10px; color: #8899aa;
`;
export const infoRow = css`
  font-size: 11px; color: #999; display: flex; flex-wrap: wrap; gap: 6px;
  padding: 2px 10px 4px;
`;
export const markRow = css`font-size: 10px; color: #666; padding: 0 10px 4px;`;
export const markTag = css`margin-right: 6px;`;

// ─── Hand cards ───
export const handHeader = css`
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;
`;
export const handTitle = css`font-size: 14px; color: #aaa; font-weight: bold;`;
export const debugHint = css`color: #666; font-weight: normal; font-size: 12px;`;

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
`;
export const eventCardSuit = css`
  font-size: 13px;
  font-weight: bold;
  margin-top: 2px;
`;
export const cancelBtn = css`
  border: 1px solid #555; border-radius: 4px; padding: 2px 8px;
  cursor: pointer; background: transparent; color: #aaa; font-size: 11px;
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
  background: linear-gradient(180deg, rgba(30,20,15,0.95) 0%, rgba(20,12,8,0.95) 100%);
  min-width: 72px;
  width: 80px;
  text-align: center;
  transition: all 0.2s;
  transform-origin: bottom center;
  box-shadow: -1px 2px 6px rgba(0,0,0,0.3);
  margin-left: -16px;
  &:first-of-type { margin-left: 0; }
  &:hover {
    z-index: 100 !important;
    margin-bottom: 8px;
    box-shadow: 0 6px 16px rgba(0,0,0,0.5);
    border-color: #888;
  }
`;
export const handCardSelected = css`
  border: 2px solid #3498db; background: rgba(52,152,219,0.18);
  margin-bottom: 8px; box-shadow: 0 4px 12px rgba(52,152,219,0.3);
`;
export const handCardDisabled = css`opacity: 0.4; cursor: default;`;
export const handCardRespondable = css`
  border: 2px solid #ffd700;
  box-shadow: 0 0 10px rgba(255,215,0,0.4);
  background: rgba(255,215,0,0.08);
`;
// 转化模式:匹配卡牌用金色高亮表示可作为“转化后的牌”点选
export const handCardTransform = css`
  border: 2px solid #f1c40f;
  box-shadow: 0 0 10px rgba(241,196,15,0.5);
  background: rgba(241,196,15,0.08);
  cursor: pointer;
  &:hover { background: rgba(241,196,15,0.18); }
`;
// 转化模式:不匹配卡牌变灰、不可点
export const handCardTransformDisabled = css`opacity: 0.3; cursor: not-allowed;`;
// distribute(仁德/制衡/遗计):候选可分配牌金色高亮
export const handCardDistributeCandidate = css`
  border: 2px solid #f1c40f;
  box-shadow: 0 0 10px rgba(241,196,15,0.4);
  cursor: pointer;
  &:hover { background: rgba(241,196,15,0.15); }
`;
// distribute:已选中牌(待分配/待提交)绿色加粗边框
export const handCardDistributeSelected = css`
  border: 2px solid #2ecc71;
  box-shadow: 0 0 12px rgba(46,204,113,0.5);
  background: rgba(46,204,113,0.15);
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
  background: rgba(231,76,60,0.18);
`;
export const cardName = css`font-weight: bold; font-size: 16px; margin-bottom: 2px; letter-spacing: 1px;`;
export const cardSuit = css`font-size: 13px; margin-top: 2px;`;
export const cardOrigin = css`font-size: 10px; opacity: 0.7; margin-bottom: 2px; font-style: italic;`;
export const emptyHand = css`color: #555; font-size: 13px; padding: 12px;`;

// ─── 动画状态样式 ───
export const handCardNew = css`
  animation: drawCardIn 0.45s cubic-bezier(0.23, 1, 0.32, 1) both;
`;
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

// ─── Action bar ───
export const actionBar = css`
  display: flex; gap: 12px; align-items: center; margin-bottom: 12px;
`;
export const playBtn = css`
  border: none; border-radius: 6px; padding: 8px 20px;
  cursor: pointer; background: #27ae60; color: #fff; font-weight: bold; font-size: 14px;
`;
export const endTurnBtn = css`
  border: none; border-radius: 6px; padding: 8px 20px;
  cursor: pointer; background: #e74c3c; color: #fff; font-weight: bold; font-size: 14px;
`;
export const targetHint = css`font-size: 13px; color: #ffd700;`;

// ─── Target selection ───
export const targetSection = css`margin-bottom: 12px;`;
export const targetTitle = css`font-size: 13px; color: #aaa; margin-bottom: 8px; font-weight: bold;`;
export const targetList = css`display: flex; gap: 8px; flex-wrap: wrap;`;
export const targetBtn = css`
  border: 1px solid #444; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(22,33,62,0.8); color: #e0e0e0; font-size: 13px;
`;
export const targetBtnActive = css`border: 2px solid #e74c3c; background: rgba(231,76,60,0.2);`;
export const targetBtnDisabled = css`opacity: 0.35; cursor: not-allowed; border-style: dashed;`;
// Skill buttons (技能在角色卡上显示，这里只保留按钮本体样式)
export const skillBtn = css`
  border: 1px solid #9b59b6; border-radius: 4px; padding: 2px 8px;
  cursor: pointer; background: rgba(155,89,182,0.15); color: #bb8fce; font-size: 11px; font-weight: bold;
  margin-right: 3px;
  &:hover { background: rgba(155,89,182,0.3); }
`;
// 装备区中可点使用的装备技能按钮
export const equipSkillBtn = css`
  border: 1px solid #f39c12; border-radius: 4px; padding: 1px 6px;
  cursor: pointer; background: rgba(243,156,18,0.18); color: #f39c12; font-size: 10px; font-weight: bold;
  &:hover { background: rgba(243,156,18,0.32); }
`;

// ─── 下方主布局 ───
// 左:角色大卡 (320px) 右:手牌列 (flex 1)
export const bottomLayout = css`
  display: flex;
  gap: 12px;
  align-items: stretch;
  padding: 0 8px;
  margin-top: 12px;
  @media (max-width: 900px) {
    flex-direction: column;
  }
`;
export const handColumn = css`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

// ─── 角色大卡 (左侧) ───
export const playerCardLarge = css`
  flex: 0 0 320px;
  border: 1px solid #444;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(0,0,0,0.55);
  box-shadow: 0 4px 16px rgba(0,0,0,0.35);
  display: flex;
  flex-direction: column;
  @media (max-width: 900px) {
    flex: 1 1 auto;
  }
`;
export const playerCardHeader = css`
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;
export const playerCardHeaderTop = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
export const playerCardName = css`
  font-weight: bold;
  font-size: 18px;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,0.4);
`;
export const playerCardChar = css`
  font-weight: bold;
  font-size: 14px;
  color: rgba(255,255,255,0.85);
  text-shadow: 0 1px 3px rgba(0,0,0,0.4);
`;
export const playerCardEquip = css`
  padding: 6px 12px 8px;
  border-top: 1px solid rgba(255,255,255,0.06);
  background: rgba(243,156,18,0.05);
`;
export const playerCardEquipTitle = css`
  font-size: 11px;
  color: #f39c12;
  font-weight: bold;
  margin-bottom: 4px;
  letter-spacing: 1px;
`;

// ─── Debug panel ───
export const debugPanel = css`
  margin-top: 16px; border: 1px solid #333; border-radius: 8px;
  background: rgba(0,0,0,0.2);
`;
export const debugSummary = css`
  padding: 8px 12px; cursor: pointer; color: #888; font-size: 12px;
`;
export const debugContent = css`padding: 8px 12px; font-size: 12px; color: #aaa; font-family: monospace;`;
export const debugHr = css`border: none; border-top: 1px solid #333; margin: 8px 0;`;
export const debugPlayer = css`margin-bottom: 4px;`;
export const debugDead = css`text-decoration: line-through; opacity: 0.5;`;

// ─── Log panel ───
export const logPanel = css`
  margin-top: 12px; border: 1px solid #333; border-radius: 8px;
  background: rgba(0,0,0,0.2);
`;
export const logSummary = css`
  padding: 8px 12px; cursor: pointer; color: #888; font-size: 12px;
`;
export const logContent = css`
  padding: 8px 12px; font-size: 12px; color: #aaa;
  max-height: 200px; overflow-y: auto;
`;
export const logEmpty = css`color: #555; font-style: italic;`;
export const logEntry = css`
  display: flex; gap: 8px; padding: 2px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
`;
export const logTime = css`color: #666; min-width: 40px; flex-shrink: 0;`;
export const logPlayer = css`color: #3498db; font-weight: bold; min-width: 40px; flex-shrink: 0;`;
export const logText = css`color: #ccc;`;

// ─── 选将等待遮罩(并行选将:当前视角玩家已选完但其他人还在选)───
export const charSelectWaitingOverlay = css`
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);
  color: #f1c40f;
  font-size: 18px;
  gap: 12px;
`;
export const charSelectWaitingSub = css`
  font-size: 13px;
  color: #aaa;
`;
export const charSelectWaitingCountdown = css`
  width: 300px;
  margin-top: 8px;
`;
export const charSelectWaitingSwitchBtn = css`
  margin-top: 16px;
  padding: 8px 18px;
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  cursor: pointer;
`;

// ─── 已选武将卡(选将完成后展示在等待遮罩中,明确反馈选择结果)───
export const selectedCharCard = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 36px;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(255, 215, 0, 0.25), 0 4px 16px rgba(0, 0, 0, 0.4);
  border: 2px solid rgba(255, 215, 0, 0.6);
  min-width: 200px;
`;
export const selectedCharLabel = css`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 2px;
`;
export const selectedCharName = css`
  font-size: 28px;
  font-weight: bold;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
`;
export const selectedCharFaction = css`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.25);
  border-radius: 6px;
  padding: 3px 10px;
`;
export const selectedCharSkills = css`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  text-align: center;
`;
export const selectedCharHpRow = css`
  display: flex;
  gap: 4px;
  margin-top: 2px;
`;

// ─── 辅助状态样式 ───
/** 自动切换按钮激活态(绿色)。 */
export const autoSwitchActive = css`
  background: #27ae60;
  color: #fff;
`;
/** 转化模式提示文案色。 */
export const transformHint = css`
  color: #f1c40f;
  margin-left: 8px;
`;
/** 已选目标金色高亮 span(复用转化提示色系)。 */
export const selectedTargetText = css`
  color: #f1c40f;
  margin-left: 8px;
`;
/** 「距离外」等辅助提示小字(灰)。 */
export const mutedHint = css`
  font-size: 11px;
  color: #999;
  margin-left: 4px;
`;
/** 死亡「亡」徽章背景(覆盖 youBadge 的蓝色)。 */
export const deadBadge = css`
  background: #555;
`;
/** 技能按钮 danger 变体边框。 */
export const skillBtnDanger = css`border-color: #e74c3c;`;
/** 技能按钮 primary 变体边框。 */
export const skillBtnPrimary = css`border-color: #f39c12;`;
/** 按钮禁用态(出牌/转化出牌)。 */
export const btnDisabled = css`
  opacity: 0.4;
  cursor: not-allowed;
`;
/** distribute 取消按钮居中容器。 */
export const distributeCancelRow = css`
  display: flex;
  justify-content: center;
  margin-top: 6px;
`;
/** 角色大卡技能区 padding 覆盖。 */
export const skillRowPad = css`padding: 8px 12px;`;
/** 角色大卡判定区 padding 覆盖。 */
export const judgeRowPad = css`padding: 0 12px 8px;`;

// ─── Debug 快照 ───
export const snapshotBtn = css`
  background: #2d4a2d; color: #7ee787; border: 1px solid #4a8a4a;
  padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 13px;
  &:hover { background: #3d5a3d; }
  &:disabled { opacity: 0.5; cursor: wait; }
`;
export const snapshotToast = css`
  position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
  background: #1f3d1f; color: #7ee787; padding: 10px 20px; border-radius: 6px;
  border: 1px solid #4a8a4a; font-size: 13px; z-index: 9999;
  display: flex; align-items: center; gap: 10px;
`;
export const copyBtn = css`
  background: #2d4a2d; color: #7ee787; border: 1px solid #4a8a4a;
  padding: 2px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;
  white-space: nowrap;
  &:hover { background: #3d5a3d; }
`;
export const copyBtnDone = css`
  background: #1a3d1a; border-color: #2a6a2a; cursor: default;
`;
export const snapshotErrorToast = css`
  position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
  background: #3d1f1f; color: #ff7b72; padding: 10px 20px; border-radius: 6px;
  border: 1px solid #8a4a4a; font-size: 13px; z-index: 9999;
`;