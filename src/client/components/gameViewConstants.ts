// src/client/components/gameViewConstants.ts
// GameView 用的纯展示常量。从 GameView.tsx 抽离,集中管理 UI 映射表。
// 下一阶段 GameView 会改为 import 这些常量,消除重复硬编码。

/** 回合阶段中文名(渲染时把引擎 phase 翻成人类可读文案) */
export const PHASE_LABELS: Record<string, string> = {
  '准备': '准备阶段',
  '判定': '判定阶段',
  '摸牌': '摸牌阶段',
  '出牌': '出牌阶段',
  '弃牌': '弃牌阶段',
  '回合结束': '回合结束',
};

/** 花色 → 文字色(黑桃/梅花灰色,红桃/方块红色) */
export const SUIT_COLOR: Record<string, string> = {
  '♠': '#ccc',
  '♣': '#ccc',
  '♥': '#e74c3c',
  '♦': '#e74c3c',
};

/** 势力背景色(座位卡/选将面板用) */
export const FACTION_BG: Record<string, string> = {
  '魏': '#2c3e50',
  '蜀': '#27ae60',
  '吴': '#c0392b',
  '群': '#8e44ad',
};

/** 身份牌背景色(身份揭示遮罩 + 座位标识) */
export const IDENTITY_COLORS: Record<string, string> = {
  '主公': '#FFD700',
  '忠臣': '#4A90E2',
  '反贼': '#E74C3C',
  '内奸': '#9B59B6',
};