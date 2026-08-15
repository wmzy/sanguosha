// Prompt 区样式:询问/回应提示框 + 动作按钮变体 + 等待提示 + 辅助状态(转化/distribute 提示、徽章、禁用态)。

import { css } from '@linaria/core';

// ─── Prompt ───
export const promptBox = css`
  border: 2px solid #e67e22;
  border-radius: 8px;
  padding: 8px 14px;
  background: rgba(230, 126, 34, 0.15);
  width: 100%;
  box-sizing: border-box;
`;
export const promptBoxAwaiting = css`
  border: 2px solid #e74c3c;
  border-left: 4px solid #e74c3c;
  border-radius: 8px;
  padding: 8px 14px;
  background: rgba(231, 76, 60, 0.1);
  width: 100%;
  box-sizing: border-box;
`;
export const promptTitle = css`
  color: #e67e22;
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 2px;
`;
export const promptDesc = css`
  font-size: 13px;
  margin-bottom: 4px;
`;
export const promptActions = css`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;
// prompt 动作区变体:装备/判定/手牌盲选等多行内容,换行间距更紧
export const promptActionsWrap = css`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;
// prompt 描述变体:占满整行(分组标题,如「装备区:」)
export const promptDescFull = css`
  font-size: 14px;
  width: 100%;
  margin-bottom: 0;
`;
// prompt 描述变体:单行内联(垂直居中,无下边距)
export const promptDescInline = css`
  font-size: 14px;
  margin-bottom: 0;
  align-self: center;
`;
export const promptBtn = css`
  border: 1px solid #888;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  font-size: 13px;
`;
// 选牌面板手牌盲选:牌背卡片行(替代原纯序号数字按钮,视觉对应目标手牌牌背)
export const pickHandRow = css`
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`;

// 单张牌背卡片(可点击):固定卡片比例,内嵌 CardBack 填满;hover 上浮高亮
export const pickHandCard = css`
  position: relative;
  width: 44px;
  height: 62px;
  padding: 0;
  border: 1.5px solid #a8842a;
  border-radius: 5px;
  overflow: hidden;
  cursor: pointer;
  background: #f5e6c8;
  transition:
    transform 0.12s,
    box-shadow 0.12s,
    border-color 0.12s;

  &:hover {
    transform: translateY(-3px);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
    border-color: #ffd700;
    z-index: 1;
  }
`;

// 牌背角标序号(左上角半透明底,金字)
export const pickHandIndex = css`
  position: absolute;
  top: 2px;
  left: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.65);
  color: #ffd700;
  font-size: 10px;
  font-weight: bold;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
`;
export const promptBtnPrimary = css`
  border: 1px solid #27ae60;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  background: rgba(39, 174, 96, 0.2);
  color: #2ecc71;
  font-size: 13px;
  font-weight: bold;
`;
// 五谷丰登:被选走的牌(置暗禁用)
export const promptBtnDisabled = css`
  border: 1px solid #555;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: not-allowed;
  background: rgba(40, 40, 40, 0.5);
  color: #666;
  font-size: 13px;
  opacity: 0.6;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
`;
export const pickedByTag = css`
  font-size: 10px;
  color: #e74c3c;
  font-weight: normal;
  text-decoration: line-through;
`;

// chooseOption 武将牌面板按钮(化身:势力色底+武将名+技能列表)
export const chooseOptionCard = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border: 2px solid #888;
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 13px;
  transition: transform 0.1s;
  &:hover {
    transform: scale(1.03);
  }
`;
export const chooseOptionCardName = css`
  font-weight: bold;
  font-size: 15px;
`;
export const chooseOptionCardSkills = css`
  font-size: 12px;
  color: #888;
`;

export const waitingHint = css`
  text-align: center;
  color: #888;
  font-size: 13px;
  margin-bottom: 12px;
`;

// 自动跳过此类开关:小字 checkbox,低调显示在 prompt 描述下方
export const autoSkipToggle = css`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #aaa;
  cursor: pointer;
  margin-bottom: 8px;
  user-select: none;
  & input {
    cursor: pointer;
  }
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
/** distribute(制衡/仁德/遗计)提示文案色。 */
export const distHint = css`
  color: #1abc9c;
  margin-left: 8px;
`;
/** 死亡「亡」徽章背景(覆盖 youBadge 的蓝色)。 */
export const deadBadge = css`
  background: #555;
`;
/** 技能按钮 danger 变体边框。 */
export const skillBtnDanger = css`
  border-color: #e74c3c;
`;
/** 技能按钮 primary 变体边框。 */
export const skillBtnPrimary = css`
  border-color: #f39c12;
`;
/** 按钮禁用态(出牌/转化出牌)。 */
export const btnDisabled = css`
  opacity: 0.4;
  cursor: not-allowed;
`;
/** 角色大卡技能区 padding 覆盖。 */
export const skillRowPad = css`
  padding: 8px 12px;
`;
/** 角色大卡判定区 padding 覆盖。 */
export const judgeRowPad = css`
  padding: 0 12px 8px;
`;
