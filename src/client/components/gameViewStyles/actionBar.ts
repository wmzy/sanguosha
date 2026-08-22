// 操作栏 + 技能/装备按钮 + 装备区纵向列 + 角色大卡样式。

import { css } from '@linaria/core';

// ─── Action bar(中央操作台内) ───
export const actionBar = css`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 8px;
  border: 1px solid rgba(83, 70, 41, 0.6);
  &:empty {
    display: none;
  }
`;
export const playBtn = css`
  border: none;
  border-radius: 8px;
  padding: 8px 22px;
  cursor: pointer;
  background: linear-gradient(rgba(46, 204, 113, 0.95), rgba(30, 150, 85, 0.95));
  color: #fff;
  font-weight: bold;
  font-size: 14px;
  letter-spacing: 1px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    0 3px 10px rgba(0, 0, 0, 0.35);
  transition: all 0.15s;
  &:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }
  &:active {
    transform: translateY(0);
    filter: brightness(0.95);
  }
`;
export const endTurnBtn = css`
  border: none;
  border-radius: 8px;
  padding: 8px 22px;
  cursor: pointer;
  background: linear-gradient(rgba(240, 82, 60, 0.96), rgba(196, 54, 38, 0.96));
  color: #fff;
  font-weight: bold;
  font-size: 14px;
  letter-spacing: 2px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    0 3px 12px rgba(196, 54, 38, 0.4),
    0 0 18px rgba(231, 76, 60, 0.25);
  transition: all 0.15s;
  animation: endTurnBreath 2.4s ease-in-out infinite;
  &:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }
  &:active {
    transform: translateY(0);
    filter: brightness(0.95);
    animation: none;
  }
`;
export const targetHint = css`
  font-size: 13px;
  color: #ffd700;
  width: 100%;
  text-align: center;
`;

// Skill buttons (技能在角色卡上显示，这里只保留按钮本体样式)
// 官方形态:暗色小牌叠放——暗铜底 + 金铜描边 + 金字,hover 亮金边微光
export const skillBtn = css`
  border: 1px solid #8a7448;
  border-radius: 3px;
  padding: 2px 7px;
  cursor: pointer;
  background: linear-gradient(rgba(58, 48, 32, 0.95), rgba(38, 32, 22, 0.95));
  color: #e8d9a8;
  font-size: 10px;
  font-weight: bold;
  margin-right: 3px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  box-shadow: inset 0 1px 0 rgba(255, 235, 180, 0.07);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  &:hover {
    border-color: #d4a048;
    box-shadow:
      0 0 8px rgba(212, 160, 72, 0.4),
      inset 0 1px 0 rgba(255, 235, 180, 0.07);
  }
`;
// 技能按钮禁用态:自己回合出牌阶段内,技能存在但当前不可发动(限一次已用/activeWhen 不满足)。
// 降饱和 + 禁用光标,保留按钮形态(不退化为被动标签),让玩家能区分「已用/条件不满足」与「不存在」。
export const skillBtnDisabled = css`
  cursor: not-allowed;
  border-color: #565043;
  background: linear-gradient(rgba(42, 38, 30, 0.95), rgba(30, 27, 21, 0.95));
  color: #6f6a58;
  &:hover {
    border-color: #565043;
    box-shadow: none;
  }
`;
// 装备卡片:技能可发动态(橙色发光,可点击发动)
export const equipSkillActive = css`
  cursor: pointer;
  border-color: #f39c12;
  background: rgba(243, 156, 18, 0.2);
  box-shadow: 0 0 8px rgba(243, 156, 18, 0.5);
  &:hover {
    background: rgba(243, 156, 18, 0.34);
  }
`;
// 装备卡片:distribute 候选态(金色边框,可点击选中)
export const equipDistCandidate = css`
  cursor: pointer;
  border-color: #f1c40f;
  background: rgba(241, 196, 15, 0.14);
  box-shadow: 0 0 8px rgba(241, 196, 15, 0.4);
  &:hover {
    background: rgba(241, 196, 15, 0.24);
  }
`;
// 装备卡片:已选中态(向右偏移 + 绿色高亮,与手牌选中一致)
export const equipSelected = css`
  transform: translateX(8px);
  border-color: #2ecc71;
  color: #2ecc71;
  background: rgba(46, 204, 113, 0.16);
  box-shadow: 0 0 10px rgba(46, 204, 113, 0.55);
`;
// 装备卡片:可发动技能徽标(靠右)
export const equipSkillBadge = css`
  margin-left: auto;
  font-size: 11px;
`;

// ─── 装备区纵向列(最左侧) ───
export const equipColumn = css`
  flex: 0 0 156px;
  border: 1px solid rgba(196, 162, 84, 0.28);
  border-radius: 12px;
  background: linear-gradient(rgba(16, 14, 10, 0.78), rgba(10, 9, 6, 0.82));
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 232, 170, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  align-self: stretch;
`;
export const equipColumnTitle = css`
  font-size: 11px;
  color: #e8c47a;
  font-weight: bold;
  padding: 8px 12px 6px;
  letter-spacing: 2px;
  border-bottom: 1px solid rgba(196, 162, 84, 0.18);
`;
export const equipColumnList = css`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
`;
/** 进攻马 + 防御马并排一行 */
export const equipHorseRow = css`
  display: flex;
  gap: 4px;
  & > * {
    flex: 1 1 0;
    min-width: 0;
  }
`;
export const equipColumnItem = css`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #f39c12;
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(243, 156, 18, 0.06);
  border: 1px solid rgba(243, 156, 18, 0.15);
  overflow: hidden;
  /* 固定槽位高度:小图作为缩略图不撑高 */
  height: 48px;
  box-sizing: border-box;
`;
export const equipColumnIcon = css`
  font-size: 13px;
  flex-shrink: 0;
`;
// 装备区卡牌牌面小图:填满左侧,失败时隐藏显示 icon 回退
export const equipCardArt = css`
  width: 32px;
  height: 44px;
  object-fit: cover;
  object-position: center top;
  flex-shrink: 0;
  border-radius: 3px;
  display: block;
`;
// 空装备槽占位卡框:与 equipColumnItem 同尺寸,虚线边框 + 半透明,保证 5 槽布局固定
export const equipSlotEmpty = css`
  opacity: 0.4;
  border: 1px dashed rgba(243, 156, 18, 0.22);
  background: transparent;
`;
export const equipSlotEmptyLabel = css`
  color: #777;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
export const equipItemName = css`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

// ─── 角色大卡 (底栏右侧,官方 OL 竖版武将卡) ───
// 立绘填满 + 细金铜描边 + 外圈深色;卡内左缘竖带(身份章/竖排武将名/体力数字)、
// 右缘体力珠列骑边、底部紧凑技能排。圆角裁剪由立绘/内容两层自担,根层 overflow
// 保持 visible 让体力珠骑在右边框上。
export const playerCardLarge = css`
  position: relative;
  box-sizing: border-box;
  /* 宽高比 = 武将立绘 750×950(15:19);高度跟随底栏 stretch,
     宽度由比例推导(200px 高 → ≈158px 宽),立绘完整不裁切 */
  flex: 0 0 auto;
  aspect-ratio: 15 / 19;
  border: 1px solid #8a7448;
  border-radius: 6px;
  background: #14110c;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.6),
    0 6px 18px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  align-self: stretch;
`;
// 自己处于回合时:金绿双层辉光边框(谁的回合一目了然)
export const playerCardTurn = css`
  border-color: #d4a048;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.6),
    0 0 16px rgba(255, 205, 92, 0.45),
    0 0 32px rgba(110, 190, 100, 0.22);
`;
// 名牌横条(卡顶):玩家名 + 徽章组(我/回合/⛓)
export const playerCardHeader = css`
  padding: 5px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: linear-gradient(rgba(20, 16, 10, 0.9), rgba(13, 10, 7, 0.74));
  border-bottom: 1px solid rgba(138, 116, 72, 0.5);
`;
export const playerCardHeaderTop = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;
export const playerCardName = css`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: bold;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.94);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
`;
// 名牌右侧徽章组
export const playerCardBadges = css`
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
`;
export const playerCardBadgeYou = css`
  background: rgba(52, 152, 219, 0.92);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  color: #fff;
  font-weight: bold;
  line-height: 1.5;
`;
export const playerCardBadgeTurn = css`
  background: #d4a017;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  color: #241a04;
  font-weight: bold;
  line-height: 1.5;
`;
export const playerCardBadgeChain = css`
  display: inline-flex;
  align-items: center;
  background: linear-gradient(135deg, #6b8294, #9bb3c4);
  border: 1px solid #b9cdd9;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 10px;
  color: #fff;
  font-weight: bold;
  line-height: 1.5;
`;
// 身份小方章:base + 主公金/忠臣蓝/反贼红/内奸紫变体(与座位卡名牌身份章同语言)
export const playerCardStampBase = css`
  flex-shrink: 0;
  min-width: 22px;
  text-align: center;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: bold;
  line-height: 1.5;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
`;
export const playerCardStampLord = css`
  background: #d4a017;
  color: #3a2400;
`;
export const playerCardStampLoyalist = css`
  background: #3f6fb5;
  color: #fff;
`;
export const playerCardStampRebel = css`
  background: #b03a30;
  color: #fff;
`;
export const playerCardStampRenegade = css`
  background: #8e5aa8;
  color: #fff;
`;
// 卡内左缘竖带:自上而下渐变暗带;顶部身份章、中间竖排武将名、底部体力数字
export const playerCardSideBand = css`
  position: absolute;
  left: 0;
  top: 32px; /* 名牌条之下 */
  bottom: 4px;
  z-index: 3;
  width: 30px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 5px 0 8px;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.62) 0%,
    rgba(0, 0, 0, 0.42) 60%,
    rgba(0, 0, 0, 0.08) 100%
  );
`;
// 竖排武将名(原顶部条横排名,重塑为左缘竖排):vertical-rl + upright,金白粗体深色描边
export const playerCardChar = css`
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-weight: bold;
  font-size: 13px;
  letter-spacing: 3px;
  color: #f3e6c2;
  text-shadow:
    1px 0 2px rgba(0, 0, 0, 0.9),
    -1px 0 2px rgba(0, 0, 0, 0.9),
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 -1px 2px rgba(0, 0, 0, 0.9);
`;
// 竖带底部体力数字(当前体力):红色粗体,伤害/回复红/绿闪烁挂在此处
export const playerCardHpNumber = css`
  flex-shrink: 0;
  display: inline-block;
  line-height: 1;
  font-size: 17px;
  font-weight: 900;
  color: #ff5f52;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.85),
    0 0 6px rgba(255, 60, 40, 0.45);
`;
// 右缘体力珠列:垂直排列,骑在卡右边框上(与座位卡同款水滴珠;尺寸由内联按 maxHealth 缩放)
export const playerCardHpBeadCol = css`
  position: absolute;
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
`;
export const playerCardHpBeadFull = css`
  box-sizing: border-box;
  flex-shrink: 0;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
  background: linear-gradient(135deg, #7ec850 8%, #3e8f2e 92%);
  border: 1px solid rgba(46, 94, 28, 0.9);
  box-shadow:
    inset 0 2px 2px rgba(255, 255, 255, 0.35),
    inset 0 -1px 2px rgba(0, 0, 0, 0.25),
    0 0 6px rgba(126, 200, 80, 0.45);
`;
export const playerCardHpBeadEmpty = css`
  box-sizing: border-box;
  flex-shrink: 0;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid #444;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.55);
`;
// 死亡「亡」印章:旋转 -12deg 红字大印盖在卡面(立绘同时 grayscale)
export const playerCardDeadStamp = css`
  position: absolute;
  top: 46%;
  left: 50%;
  z-index: 4;
  transform: translate(-50%, -50%) rotate(-12deg);
  padding: 2px 8px 2px 14px;
  border: 3px solid rgba(200, 40, 34, 0.85);
  border-radius: 8px;
  background: rgba(20, 6, 4, 0.35);
  color: rgba(226, 56, 48, 0.92);
  font-size: 34px;
  font-weight: 900;
  letter-spacing: 6px;
  text-shadow: 0 0 10px rgba(180, 30, 24, 0.6);
  pointer-events: none;
`;
// 武将大卡立绘:整个卡牌的背景层(自身圆角裁剪),文字内容在其上
export const playerCardPortrait = css`
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  border-radius: 5px;
  background: var(--faction-color, rgba(0, 0, 0, 0.45));
`;
export const playerCardPortraitImg = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  transition: filter 0.3s;
`;
export const playerCardPortraitDead = css`
  filter: grayscale(1) brightness(0.6);
`;
// 横置(铁索连环):大卡铁链光泽脉冲,代表武将牌横置状态(chainPulse 定义在 animations.css)
export const playerCardChained = css`
  animation: chainPulse 1.8s ease-in-out infinite;
`;
// 大卡文字内容层:浮在立绘上;中部透出立绘,顶部名牌/底部技能排各自带暗底
export const playerCardContent = css`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 5px;
`;
// 卡底部紧凑区:技能按钮排 + 判定行 + 手牌角标(官方为暗色小牌叠放);左让开竖带
export const playerCardBottom = css`
  margin-top: auto;
  margin-left: 30px;
  padding: 5px 12px 6px 2px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: linear-gradient(
    to top,
    rgba(10, 8, 5, 0.9) 0%,
    rgba(10, 8, 5, 0.78) 72%,
    rgba(10, 8, 5, 0) 100%
  );
`;
export const playerCardSkillRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
`;
// 被动技能标签:暗底金字小圆角(与座位卡技能 chips 同语言)
export const playerCardSkillTag = css`
  display: inline-block;
  background: rgba(10, 8, 6, 0.68);
  border: 1px solid rgba(138, 116, 72, 0.42);
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 10px;
  color: #e8c47a;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
`;
// 判定行(延时锦囊):紫边 chip,花色点数着色
export const playerCardJudgeRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  font-size: 10px;
`;
export const playerCardJudgeLabel = css`
  color: #c9a2ff;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
`;
export const playerCardJudgeTag = css`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid #8e6cc8;
  color: var(--suit-color, #ccc);
  background: rgba(24, 16, 34, 0.78);
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
`;
// 手牌数角标:底部区右下角小暗章
export const playerCardHandChip = css`
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(138, 116, 72, 0.5);
  color: #e8c47a;
  font-size: 10px;
  font-weight: bold;
  line-height: 1.4;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
`;
export const playerCardEquip = css`
  padding: 6px 12px 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(243, 156, 18, 0.05);
`;
export const playerCardEquipTitle = css`
  font-size: 11px;
  color: #f39c12;
  font-weight: bold;
  margin-bottom: 4px;
  letter-spacing: 1px;
`;
