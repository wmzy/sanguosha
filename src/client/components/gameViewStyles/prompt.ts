// Prompt 区样式:询问/回应提示框 + 动作按钮变体 + 等待提示 + 辅助状态(转化/distribute 提示、徽章、禁用态)。

import { css } from '@linaria/core';

// ─── Prompt ───
export const promptBox = css`
  border: 2px solid #e67e22;
  border-radius: 8px;
  padding: 12px 16px;
  background: rgba(230, 126, 34, 0.15);
  margin-bottom: 12px;
`;
export const promptBoxAwaiting = css`
  border: 2px solid #e74c3c;
  border-left: 4px solid #e74c3c;
  border-radius: 8px;
  padding: 12px 16px;
  background: rgba(231, 76, 60, 0.1);
  margin-bottom: 12px;
`;
export const promptTitle = css`
  color: #e67e22;
  font-weight: bold;
  font-size: 15px;
  margin-bottom: 4px;
`;
export const promptDesc = css`
  font-size: 14px;
  margin-bottom: 8px;
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
// prompt 按钮变体:手牌盲选用,保证序号按钮最小可点区域
export const promptBtnMin = css`
  border: 1px solid #888;
  border-radius: 6px;
  padding: 6px 14px;
  min-width: 40px;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  font-size: 13px;
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

export const waitingHint = css`
  text-align: center;
  color: #888;
  font-size: 13px;
  margin-bottom: 12px;
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
