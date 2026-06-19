// src/engine/card-meta.ts
// 卡牌元数据查询函数。供前端/工具模块复用,避免在多处重复硬编码类型/子类型判定。

import type { Card } from './types';

/** 装备牌 */
export function isEquipment(c: Card): boolean {
  return c.type === '装备牌';
}

/** 延时锦囊(乐不思蜀/兵粮寸断/闪电) */
export function isDelayedTrick(c: Card): boolean {
  return c.type === '锦囊牌' && c.trickSubtype === '延时锦囊';
}

/** 响应型卡牌(闪 / 无懈可击):只能在被指定时打出,不能主动使用 */
export function isRespondOnly(c: Card): boolean {
  return c.name === '闪' || c.trickSubtype === '响应锦囊';
}

/** 武器攻击范围。无 range 字段视为徒手(1) */
export function getWeaponRange(c: Card): number {
  return c.range ?? 1;
}

// ─── 出牌规则常量 ───
// 这些定义了哪些牌需要选目标、需要几个目标、自动以自己为目标等。
// 集中定义避免在前端多处重复硬编码。

/** 需要攻击范围内才能选目标的牌 */
export const RANGE_REQUIRED_CARDS = new Set(['杀', '顺手牵羊']);

/** 需要选目标的牌(使用时必须指定 target) */
export const TARGET_REQUIRED_CARDS = new Set(['杀', '过河拆桥', '顺手牵羊', '借刀杀人', '决斗', '乐不思蜀']);

/** 需要选两个目标(A + B)的牌 */
export const TWO_TARGET_CARDS = new Set(['借刀杀人']);

/** 自动以自己为目标的牌(无需手动选目标) */
export const SELF_TARGET_CARDS = new Set(['桃', '酒']);

/** 只能作为回应打出的牌(不能主动使用) */
export const RESPOND_ONLY_CARDS = new Set(['闪', '无懈可击']);