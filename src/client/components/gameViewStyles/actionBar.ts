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
  border-radius: 6px;
  padding: 8px 20px;
  cursor: pointer;
  background: #27ae60;
  color: #fff;
  font-weight: bold;
  font-size: 14px;
`;
export const endTurnBtn = css`
  border: none;
  border-radius: 6px;
  padding: 8px 20px;
  cursor: pointer;
  background: #e74c3c;
  color: #fff;
  font-weight: bold;
  font-size: 14px;
`;
export const targetHint = css`
  font-size: 13px;
  color: #ffd700;
  width: 100%;
  text-align: center;
`;

// Skill buttons (技能在角色卡上显示，这里只保留按钮本体样式)
export const skillBtn = css`
  border: 1px solid #9b59b6;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  background: rgba(155, 89, 182, 0.15);
  color: #bb8fce;
  font-size: 11px;
  font-weight: bold;
  margin-right: 3px;
  &:hover {
    background: rgba(155, 89, 182, 0.3);
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
  border: 1px solid #444;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.45);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  align-self: stretch;
  @media (max-width: 900px) {
    flex: 1 1 auto;
  }
`;
export const equipColumnTitle = css`
  font-size: 11px;
  color: #f39c12;
  font-weight: bold;
  padding: 8px 12px 6px;
  letter-spacing: 1px;
  border-bottom: 1px solid rgba(243, 156, 18, 0.15);
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

// ─── 角色大卡 (右侧) ───
export const playerCardLarge = css`
  flex: 0 0 260px;
  border: 1px solid #444;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.55);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  align-self: stretch;
  @media (max-width: 900px) {
    flex: 1 1 auto;
  }
`;
// 自己处于回合时:金色高亮边框(谁的回合一目了然)
export const playerCardTurn = css`
  box-shadow:
    0 0 20px rgba(255, 215, 0, 0.45),
    inset 0 0 8px rgba(255, 215, 0, 0.08);
  outline: 2px solid #ffd700;
  outline-offset: -2px;
`;
export const playerCardHeader = css`
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--faction-color, transparent);
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
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
`;
export const playerCardChar = css`
  font-weight: bold;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
`;
// 武将大卡立绘:在头部下方、体力上方,占住卡的上半区域
export const playerCardPortrait = css`
  position: relative;
  width: 100%;
  height: 200px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.45);
  border-bottom: 1px solid rgba(0, 0, 0, 0.4);
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
