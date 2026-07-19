// 页面级布局样式:页面骨架 + Header + 主内容(战场区+右侧边栏) + 底部手牌区。
// 动画 keyframes 见 src/client/animations.css(由 main.tsx 全局引入)。
//
// 参照官方三国杀界面布局:
//   ┌─────────────────────────────────────────────────┐
//   │ topbar (固定高度,极简)                          │
//   ├──────────────────────────────────┬──────────────┤
//   │                                  │ 右侧边栏     │
//   │       battle-field (flex 1)      │ (固定宽250px)│
//   │   ┌─座位环绕中央─┐                │  日志+聊天   │
//   │   │  处理区/牌堆  │                │  tabs       │
//   │   └──────────────┘                │              │
//   │   [prompt 浮在战场底部]            │              │
//   ├──────────────────────────────────┴──────────────┤
//   │ bottombar (固定高度 160px):装备 | 手牌 | 我方武将 │
//   └─────────────────────────────────────────────────┘

import { css } from '@linaria/core';
import { colors } from '../../theme';

// ─── 页面骨架 ───
export const pageRoot = css`
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
  background-color: ${colors.bg.page};
  color: ${colors.text.primary};
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

// ─── Header(顶部栏,固定高度) ───
export const headerBar = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex: 0 0 auto;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.45);
  border-bottom: 1px solid #534629;
`;
export const backBtn = css`
  border: 1px solid #555;
  border-radius: 4px;
  padding: 3px 10px;
  cursor: pointer;
  background: transparent;
  color: #e0e0e0;
  font-size: 12px;
`;
export const headerCenter = css`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
`;
export const roundBadge = css`
  background: #0f3460;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  color: #8899aa;
`;
export const phaseBadge = css`
  background: #e67e22;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  color: #fff;
  font-weight: bold;
`;
export const currentPlayerText = css`
  color: #ffd700;
  font-size: 12px;
`;
export const headerRight = css`
  display: flex;
  gap: 8px;
  align-items: center;
`;
export const perspectiveBtn = css`
  border: 1px solid #3498db;
  border-radius: 4px;
  padding: 3px 10px;
  cursor: pointer;
  background: transparent;
  color: #3498db;
  font-size: 12px;
`;
export const goToBtn = css`
  border: 1px solid #555;
  border-radius: 4px;
  padding: 3px 10px;
  cursor: pointer;
  background: transparent;
  color: #aaa;
  font-size: 12px;
`;

// ─── 主内容:左侧战场区 + 右侧边栏 ───
export const mainContent = css`
  flex: 1 1 auto;
  display: flex;
  flex-direction: row;
  min-height: 0;
  overflow: hidden;
`;

// 战场区:座位环绕中央(处理区/牌堆/弃牌堆),操作 prompt 浮在底部
export const battleField = css`
  flex: 1 1 auto;
  position: relative;
  background: radial-gradient(circle at center, rgba(60, 45, 30, 0.3), transparent);
  min-width: 0;
  overflow: hidden;
`;

// 右侧边栏:固定宽 250px,承载日志+聊天(InfoDock 内嵌于此而非浮窗)
export const rightSidebar = css`
  flex: 0 0 250px;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.6);
  border-left: 1px solid #534629;
  min-height: 0;
  overflow: hidden;
`;

// ─── 底部手牌区(固定高度) ───
// 装备区在左、手牌区在中、我方武将卡在右
export const bottomLayout = css`
  flex: 0 0 auto;
  height: 180px;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 10px 12px;
  border-top: 1px solid #534629;
  background: rgba(0, 0, 0, 0.5);
  position: relative;
  overflow: hidden;
  @media (max-width: 900px) {
    height: auto;
    flex-direction: column;
    align-items: stretch;
  }
`;
export const handColumn = css`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: flex-end;
  height: 100%;
`;
