// src/client/components/gameViewConstants.ts
// GameView / PlayerSeatView 共用的纯展示常量与映射表。
// 所有「会重复出现的魔法字符串/颜色/图标」集中在此,前端组件不得自带副本。

import type { EquipSlot } from '../../engine/types';
import { getEquipmentSkillNames } from '../../engine/card-meta';

/** 回合阶段中文名(渲染时把引擎 phase 翻译人类可读文案) */
export const PHASE_LABELS: Record<string, string> = {
  '准备': '准备阶段',
  '判定': '判定阶段',
  '摸牌': '摸牌阶段',
  '出牌': '出牌阶段',
  '弃牌': '弃牌阶段',
  '回合结束': '回合结束',
};

/** 装备牌自带的技能名集合。
 *  从卡牌数据(装备牌列表)与技能注册表(skillLoaders)派生,见 card-meta.ts。
 *  用于从 player.skills 过滤掉装备技能,使其在装备区而非技能区显示。 */
export const EQUIPMENT_SKILL_NAMES: ReadonlySet<string> = getEquipmentSkillNames();

/** 装备槽 → 图标(emoji)。用于装备区卡片前的视觉标识。 */
export const EQUIP_SLOT_ICON: Record<EquipSlot, string> = {
  '武器': '⚔',
  '防具': '🛡',
  '进攻马': '🐎+',
  '防御马': '🐎-',
  '宝物': '💎',
};

/** 装备区固定槽位顺序。渲染时始终展示全部 5 槽,空槽显示占位卡框(布局固定不抖动)。 */
export const EQUIP_SLOT_ORDER: EquipSlot[] = ['武器', '防具', '进攻马', '防御马', '宝物'];

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

/** 日志时间戳格式化:ms → `M:SS` 或 `Ss`。用于游戏日志面板。 */
export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}