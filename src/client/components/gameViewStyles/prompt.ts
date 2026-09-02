// Prompt 区样式:询问/回应提示框 + 动作按钮变体 + 等待提示 + 辅助状态(转化/distribute 提示、徽章、禁用态)。
// 面板形态对齐官方 OL 客户端:横向底部横幅(暗皮革底 + 金铜双线描边 + 底部金色底线),
// 按钮分暗铜石(基础)与红漆(主行动)两种质感。

import { css } from '@linaria/core';

// ─── Prompt ───
// 官方横幅面板基底:双线描边(1px 金铜边框 + inset 深色内线)、圆角 8px、底部 2px 金色底线
export const promptBox = css`
  position: relative;
  border: 1px solid #8a7448;
  border-radius: 8px;
  padding: 10px 14px 12px;
  background: linear-gradient(#241d14f2, #171209f2);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.6),
    0 4px 16px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
  width: min(720px, 92%);
  margin: 0 auto;
  box-sizing: border-box;
  &::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 3px;
    height: 2px;
    border-radius: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(232, 196, 122, 0.55) 18%,
      rgba(240, 215, 138, 0.85) 50%,
      rgba(232, 196, 122, 0.55) 82%,
      transparent
    );
    pointer-events: none;
  }
`;
// 等待回应面板:与 promptBox 同一横幅形态(金铜描边,靠标题/按钮语义区分紧迫感)
export const promptBoxAwaiting = css`
  position: relative;
  border: 1px solid #8a7448;
  border-radius: 8px;
  padding: 10px 14px 12px;
  background: linear-gradient(#241d14f2, #171209f2);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.6),
    0 4px 16px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
  width: min(720px, 92%);
  margin: 0 auto;
  box-sizing: border-box;
  &::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 3px;
    height: 2px;
    border-radius: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(232, 196, 122, 0.55) 18%,
      rgba(240, 215, 138, 0.85) 50%,
      rgba(232, 196, 122, 0.55) 82%,
      transparent
    );
    pointer-events: none;
  }
`;
// 标题:金色粗体,前置「◆」小菱形装饰,字间距 2px
export const promptTitle = css`
  color: #f0d78a;
  font-weight: bold;
  font-size: 15px;
  margin-bottom: 4px;
  letter-spacing: 2px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  &::before {
    content: '◆';
    font-size: 10px;
    margin-right: 6px;
    color: #c4a254;
    text-shadow: none;
  }
`;
// 出牌阶段标题行的杀次数徽标(⚔️ 杀 X/Y / 杀 ∞),数据源 view.turnUsage 投影。
// 视觉沿用 seat 徽章模式(圆角小底色块),配色与 prompt 区金色主题一致。
export const slashCountBadge = css`
  display: inline-block;
  vertical-align: middle;
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid rgba(230, 126, 34, 0.6);
  background: rgba(0, 0, 0, 0.25);
  color: #f5b041;
  font-size: 12px;
  font-weight: normal;
`;
export const promptDesc = css`
  font-size: 13px;
  color: #d8cba8;
  margin-bottom: 6px;
`;
// 动作区:横排,放不下时换行(与标题同向的横向面板)
export const promptActions = css`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;
// prompt 动作区变体:装备/判定/手牌盲选等多行内容,行间距更紧
export const promptActionsWrap = css`
  display: flex;
  gap: 6px 10px;
  flex-wrap: wrap;
`;
// prompt 描述变体:占满整行(分组标题,如「装备区:」)
export const promptDescFull = css`
  font-size: 12px;
  color: #cbbd93;
  width: 100%;
  margin-bottom: 0;
`;
// prompt 描述变体:单行内联(垂直居中,无下边距)
export const promptDescInline = css`
  font-size: 13px;
  color: #d8cba8;
  margin-bottom: 0;
  align-self: center;
`;
// 基础按钮(不回应/取消/普通选项):暗铜石质感,hover 亮金边
export const promptBtn = css`
  border: 1px solid #6a5a3e;
  border-radius: 4px;
  padding: 7px 22px;
  cursor: pointer;
  background: linear-gradient(#3a352c, #2a251d);
  color: #e8d9a8;
  font-size: 13px;
  line-height: 1.4;
  box-shadow:
    inset 0 1px 0 rgba(255, 235, 180, 0.06),
    0 2px 6px rgba(0, 0, 0, 0.4);
  transition:
    border-color 0.15s,
    filter 0.15s;
  &:hover {
    border-color: #d4a048;
    filter: brightness(1.12);
  }
  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    color: #8a8068;
    filter: none;
  }
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
// 主行动按钮(出牌/确认/选项):红漆质感,金铜描边,hover 提亮
export const promptBtnPrimary = css`
  border: 1px solid #d4a048;
  border-radius: 4px;
  padding: 7px 22px;
  cursor: pointer;
  background: linear-gradient(#a03028, #7a2018);
  color: #f5e6c8;
  font-size: 13px;
  font-weight: bold;
  letter-spacing: 1px;
  line-height: 1.4;
  text-shadow: 0 1px 2px rgba(60, 10, 6, 0.8);
  box-shadow:
    inset 0 1px 0 rgba(255, 220, 160, 0.18),
    0 2px 8px rgba(122, 32, 24, 0.45);
  transition:
    filter 0.15s,
    border-color 0.15s;
  &:hover {
    border-color: #f0c060;
    filter: brightness(1.15);
  }
  &:active {
    filter: brightness(0.95);
  }
`;
// 五谷丰登:被选走的牌(置暗禁用)
export const promptBtnDisabled = css`
  border: 1px solid #55503f;
  border-radius: 4px;
  padding: 7px 22px;
  cursor: not-allowed;
  background: linear-gradient(#332f28, #26221b);
  color: #6f6a58;
  font-size: 13px;
  line-height: 1.4;
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
  border-color: rgba(94, 190, 120, 0.6) !important;
  color: #86e0a0 !important;
  background: rgba(94, 190, 120, 0.1) !important;
  &:hover {
    border-color: rgba(130, 220, 155, 0.8) !important;
    background: rgba(94, 190, 120, 0.18) !important;
  }
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
