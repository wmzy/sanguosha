// src/engine/card-meta.ts
// 卡牌元数据查询函数。供前端/工具模块复用,避免在多处重复硬编码类型/子类型判定。

import type { Card } from './types';
import { 装备牌列表 } from '../shared/cards/equipment';
import { skillLoaders } from './skills';

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

// 出牌规则(目标数/距离/自疗)已迁移到各牌技能 onMount 的 defineAction prompt:
//   - targetFilter.min/max/slots 表达目标数(含借刀杀人多槽位)
//   - targetFilter.filter 表达距离检查(杀/顺手牵羊/乐不思蜀)
//   - selfTarget 表达自疗(桃/酒)
//   - RESPOND_ONLY 由"该牌是否有 use action"隐含判断
// 前端通过 findActionAcrossOwners 读 use action 的 prompt 驱动 UI。

// ─── 装备技能名(从卡牌数据派生,非写死) ───
// 装备牌装上时会以 card.name 作 skillId 动态挂载技能实例(见 装备通用.ts)。
// 哪些装备牌「自带技能」的唯一判据是:卡牌名能在 skillLoaders 里查到。
// 这里取 装备牌列表.name ∩ skillLoaders 的 key,避免前端写死名单漂移。
// 马匹(赤兔等)不在 skillLoaders 中,自动排除;未实现技能的装备(如麒麟弓)同理排除。
const EQUIPMENT_SKILL_NAMES_CACHE: ReadonlySet<string> = new Set(
  装备牌列表
    .map((def) => def.name)
    .filter((name) => Object.prototype.hasOwnProperty.call(skillLoaders, name)),
);

/** 装备牌自带的技能名集合(从卡牌数据 + 技能注册表派生)。 */
export function getEquipmentSkillNames(): ReadonlySet<string> {
  return EQUIPMENT_SKILL_NAMES_CACHE;
}
