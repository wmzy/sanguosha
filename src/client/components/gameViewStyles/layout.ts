// 页面级布局样式:页面骨架 + Header + 下方主布局。
// 动画 keyframes 见 src/client/animations.css(由 main.tsx 全局引入)。

import { css } from '@linaria/core';
import { colors } from '../../theme';

// ─── 页面骨架 ───
export const pageRoot = css`
  padding: 12px;
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
  background-color: ${colors.bg.page};
  color: ${colors.text.primary};
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-x: hidden;
`;

// ─── Header ───
export const headerBar = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
`;
export const backBtn = css`
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
  background: transparent;
  color: #e0e0e0;
  font-size: 13px;
`;
export const headerCenter = css`
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
`;
export const roundBadge = css`
  background: #0f3460;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  color: #8899aa;
`;
export const phaseBadge = css`
  background: #e67e22;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  color: #fff;
  font-weight: bold;
`;
export const currentPlayerText = css`
  color: #ffd700;
`;
export const headerRight = css`
  display: flex;
  gap: 8px;
`;
export const perspectiveBtn = css`
  border: 1px solid #3498db;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  background: transparent;
  color: #3498db;
  font-size: 12px;
`;
export const goToBtn = css`
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  background: transparent;
  color: #aaa;
  font-size: 12px;
`;

// ─── 下方主布局 ───
// 左:装备区纵向列 / 中:手牌列 (flex 1) / 右:角色大卡 (320px)
// margin-top: auto 让操作区贴底,flex: 0 0 auto 保持内容高度(不被拉伸),
// 中央剩余空间留给上方的 seatingArea(弧形座位 + 处理区)。
export const bottomLayout = css`
  display: flex;
  gap: 12px;
  align-items: flex-end;
  padding: 0 8px;
  margin-top: auto;
  flex: 0 0 auto;
  @media (max-width: 900px) {
    flex-direction: column;
    align-items: stretch;
  }
`;
export const handColumn = css`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;
