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