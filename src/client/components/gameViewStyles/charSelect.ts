// 选将遮罩(CharSelectOverlay)样式:全屏暗幕 + 金边双线面板 + 候选武将卡网格
// (势力印章/体力点/竖排名/技能 chips/多版本组/筛选工具行/确认按钮)。
// 遮罩位于游戏画布(transform scale)内,样式一律用 px,禁止 vw/vh;从
// CharSelectOverlay.tsx 逐字迁移(属性未改动),linaria 禁止 css`` 插值组合。

import { css } from '@linaria/core';
import { cornerBracket, ornamentTitle } from './tokens';

/* 选将面板四角金色 L 角饰(8 层角件,与暗皮革底渐变叠层) */
const panelCornerBracket = cornerBracket('#c4a254', '9px', '16px', '2px');
/* 选将标题两侧饰线:亮金方钻 + 渐隐铜线(—◆—) */
const selectTitleOrnament = ornamentTitle('#e8c47a', '#8a7448');

export const overlayRoot = css`
  position: fixed;
  inset: 0;
  z-index: 10100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 16px;
  /* 暗幕 + 暗角(vignette) */
  background:
    radial-gradient(120% 90% at 50% 42%, rgba(24, 17, 10, 0) 38%, rgba(0, 0, 0, 0.6) 100%),
    rgba(10, 7, 4, 0.94);
`;

export const overlaySlotWrap = css`
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 10000;
`;

/* 金边双线面板:暗皮革底 + 双线边框 + 四角金色 L 角饰(多层 linear-gradient 角件,
   同 battleFieldDecor 的 background 叠层手法;角件画在面板自身 background 上,
   不随内部滚动移位)。画布设计高 900px → max-height 88% ≈ 790px(禁用 vh)。 */
export const panel = css`
  position: relative;
  box-sizing: border-box;
  width: 92%;
  max-width: 1150px;
  max-height: 790px;
  /* 面板为 flex 列:标题/身份/筛选/按钮固定,仅候选网格区内部滚动 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 24px 14px;
  border: 1px solid #7a6335;
  border-radius: 10px;
  box-shadow:
    inset 0 0 0 3px rgba(0, 0, 0, 0.55),
    inset 0 0 0 4px #5a4a30,
    0 18px 60px rgba(0, 0, 0, 0.6);
  background:
    ${panelCornerBracket},
    linear-gradient(#1a150f, #120d08);
`;

/* 候选网格滚动容器:占据面板剩余高度,网格超高时仅此区滚动 */
export const gridScroll = css`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
`;

/* 金书风标题:两侧装饰渐变线,近文字端一枚亮色小方钻(—◆— 意向) */
export const selectTitle = css`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 22px;
  font-weight: bold;
  color: #e8c47a;
  margin-bottom: 6px;
  letter-spacing: 6px;
  flex-shrink: 0;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);

  &::before,
  &::after {
    content: '';
    flex: 1 1 110px;
    max-width: 220px;
    height: 7px;
    background: ${selectTitleOrnament};
  }

  &::after {
    transform: scaleX(-1);
  }
`;

export const subHint = css`
  font-size: 13px;
  color: #9a8c72;
  letter-spacing: 2px;
  margin-bottom: 6px;
  text-align: center;
`;

export const countdownWrap = css`
  width: 340px;
  max-width: 100%;
  margin: 0 auto 10px;
  flex-shrink: 0;
`;

export const selfInfoRow = css`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 6px 0 8px;
  flex-shrink: 0;
`;

/* 身份印章:身份色底 + 金边,竖排两行(标签 + 值) */
export const identityBadge = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 20px;
  border-radius: 4px;
  background: var(--viewer-color);
  border: 1px solid rgba(232, 196, 122, 0.8);
  color: #fff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  min-width: 92px;
  box-sizing: border-box;
`;

/* 座次印章:暗铜底 + 铜边 */
export const seatBadge = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 20px;
  border-radius: 4px;
  background: linear-gradient(#3a352c, #2a251d);
  border: 1px solid #6a5a3e;
  color: #e8d9a8;
  min-width: 92px;
  box-sizing: border-box;
`;

export const badgeLabel = css`
  font-size: 11px;
  opacity: 0.8;
  letter-spacing: 3px;
`;

export const badgeValue = css`
  font-size: 18px;
  font-weight: bold;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
`;

/* ── 筛选工具行(势力 chips + 搜索框):方角暗铜 chips,选中金底 ── */
export const filterToolbar = css`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 10px;
  width: 100%;
  flex-shrink: 0;
`;

export const factionChips = css`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

export const factionChip = css`
  padding: 4px 14px;
  font-size: 13px;
  letter-spacing: 2px;
  color: #cfc4a8;
  background: linear-gradient(#3a352c, #2a251d);
  border: 1px solid #5a4a30;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: #e8c47a;
    border-color: #8a7448;
  }
`;

export const factionChipActive = css`
  color: #241d15;
  font-weight: bold;
  background: linear-gradient(#e8c47a, #c4a254);
  border-color: #e8c47a;

  &:hover {
    color: #241d15;
    border-color: #e8c47a;
  }
`;

export const searchInput = css`
  box-sizing: border-box;
  width: 160px;
  padding: 5px 12px;
  font-size: 13px;
  color: #f0e8d0;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid #5a4a30;
  border-radius: 4px;
  outline: none;
  transition: border-color 0.15s;

  &::placeholder {
    color: rgba(232, 196, 122, 0.4);
  }

  &:focus {
    border-color: #c4a254;
  }
`;

export const noMatchHint = css`
  margin-top: 24px;
  font-size: 15px;
  color: #8a7448;
  letter-spacing: 2px;
  text-align: center;
`;

/* 候选网格:固定 5 列,行高 300px,间距 14px(面板自身滚动,网格不限高) */
export const candidateGrid = css`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-auto-rows: 230px;
  gap: 12px;
  width: 100%;
`;

export const candidateGroupExpanded = css`
  display: flex;
  gap: 8px;
  align-items: stretch;
  width: 100%;
  height: 100%;

  & > * {
    flex: 1 1 0;
    min-width: 0;
  }
`;

export const candidateCard = css`
  position: relative;
  box-sizing: border-box;
  background: linear-gradient(#241d15, #171209);
  border: 1px solid #4a3d2a;
  border-radius: 6px;
  padding: 0;
  display: block;
  cursor: pointer;
  /* 不设 overflow:hidden:选中态 ▼ 箭头需要露出卡片下缘(立绘圆角自裁) */
  transform: translateY(0);
  transition: transform 0.25s cubic-bezier(0.23, 1, 0.32, 1), border-color 0.25s, box-shadow 0.25s;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);

  &:hover {
    transform: translateY(-6px);
    border-color: #c4a254;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55);
  }
`;

// 候选武将立绘:绝对定位填满卡片,object-fit cover
export const candidatePortraitImg = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  border-radius: 5px;
  z-index: 0;
`;

// 左上势力印章:势力色底 + 1px 金边 + 金字
export const factionSeal = css`
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  color: #e8c47a;
  background: var(--faction-color);
  border: 1px solid rgba(232, 196, 122, 0.85);
  border-radius: 3px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
`;

// 右上体力点:小圆点一排,红 #c0392b,数量 = maxHealth(多点时自动换行)
export const hpDots = css`
  position: absolute;
  top: 13px;
  right: 8px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 3px;
  max-width: 48px;
`;

export const hpDot = css`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0392b;
  box-shadow:
    0 0 3px rgba(192, 57, 43, 0.8),
    inset 0 -1px 1px rgba(0, 0, 0, 0.4);
`;

// 左缘竖排武将名:白字粗体 + 深描边,背后自上而下渐变黑条
export const candidateName = css`
  position: absolute;
  top: 38px;
  left: 0;
  z-index: 2;
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-size: 16px;
  font-weight: bold;
  color: #fff;
  letter-spacing: 5px;
  padding: 12px 5px 8px 4px;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.75),
    rgba(0, 0, 0, 0.35) 65%,
    transparent
  );
  text-shadow:
    0 0 3px #000,
    0 1px 2px #000;
  max-height: calc(100% - 44px);
  overflow: hidden;
`;

// 底部技能 chips 层:渐变蒙版上排布暗底金字小 chip
export const candidateMeta = css`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 22px 6px 8px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.85),
    rgba(0, 0, 0, 0.45) 55%,
    transparent
  );
`;

// 技能 chip:10px 暗底金字小圆角(SkillTag 承担 hover 描述)
export const skillChip = css`
  font-size: 10px;
  line-height: 1;
  color: #e8c47a;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(138, 116, 72, 0.6);
  border-radius: 3px;
  padding: 3px 6px;
  white-space: nowrap;
`;

/* 选中态:2px 金框 + 外发光 + 卡正下方金色 ▼ 箭头(CSS border 三角) */
export const candidateCardSelected = css`
  border: 2px solid #ffd700;
  box-shadow:
    0 0 18px rgba(255, 215, 0, 0.45),
    0 6px 20px rgba(0, 0, 0, 0.5);

  &::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 4px;
    border: 7px solid transparent;
    border-top-color: #ffd700;
    border-bottom-width: 0;
    filter: drop-shadow(0 0 4px rgba(255, 215, 0, 0.5));
  }

  &:hover {
    transform: translateY(-8px);
    box-shadow:
      0 0 18px rgba(255, 215, 0, 0.45),
      0 6px 20px rgba(0, 0, 0, 0.5);
  }
`;

/* 已提交锁定:其他卡灰化降透明,已选卡保持金框 + ▼ */
export const candidateCardLockedOut = css`
  opacity: 0.35;
  filter: grayscale(0.8);
  cursor: default;
`;

export const candidateCardFrozen = css`
  /* 已提交锁定:直接禁指针事件,悬浮上浮/金边变化全部停掉
     (点击防护仍由 submittedChar 守卫兜底,jsdom 测试不模拟 pointer-events) */
  pointer-events: none;
`;

/* 折叠多版本组右上角版本徽章 */
export const variantBadge = css`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  gap: 4px;
`;

export const variantTag = css`
  padding: 1px 6px;
  font-size: 11px;
  font-weight: bold;
  color: #e8d9a8;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  border: 1px solid #5a4a30;
`;

export const variantTagActive = css`
  color: #241d15;
  background: #c4a254;
  border-color: #c4a254;
`;

/* 确认按钮:红漆大按钮;未选 = 暗铜禁用;已提交保持红底(文案变「✅ 已选择 X」) */
export const confirmBtn = css`
  display: block;
  margin: 12px auto 4px;
  padding: 10px 56px;
  font-size: 17px;
  font-weight: bold;
  letter-spacing: 6px;
  border-radius: 6px;
  border: 1px solid #d4a048;
  flex-shrink: 0;
  transition: all 0.2s;
`;

export const confirmBtnIdle = css`
  color: #8a8070;
  background: linear-gradient(#3a352c, #2a251d);
  border-color: #4a4436;
  cursor: not-allowed;
  box-shadow: none;
`;

export const confirmBtnReady = css`
  color: #f5e6c8;
  background: linear-gradient(#a03028, #7a2018);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    0 4px 14px rgba(160, 48, 40, 0.35);
  cursor: pointer;

  &:hover {
    filter: brightness(1.1);
  }
`;

export const confirmBtnSubmitted = css`
  color: #f5e6c8;
  background: linear-gradient(#a03028, #7a2018);
  opacity: 0.85;
  cursor: not-allowed;
`;

export const waitingHint = css`
  margin: 56px auto;
  font-size: 18px;
  color: #b9a77f;
  letter-spacing: 4px;
  text-align: center;
`;
