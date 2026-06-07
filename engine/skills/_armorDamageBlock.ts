// engine/skills/_armorDamageBlock.ts — 装备防具：单一/多/反向伤害类型免疫钩子
//
// 藤甲/大雾这类"装备防具 + 防特定伤害类型"的对称实现。
// tengjia.ts / daqi.ts 各自调用 registerArmorDamageBlock*(armorId, ...)
// 即可注册一个 cancel 目标伤害类型的 hook。
//
// 三种 API：
// - registerArmorDamageBlock(armorId, type)         单一伤害类型免疫（藤甲/原大雾）
// - registerArmorDamageBlockMulti(armorId, types)   多伤害类型免疫
// - registerArmorDamageBlockExcept(armorId, type)   反向：防"除 type 之外的所有类型"（大雾防 non-thunder）
//
// 设计：与 kongcheng.ts 一致—— filter 阶段做 null-guard + 范围窄化，
// onBefore 仅做最终拦截（{ cancel: true }）。

import { registerAtomHook } from '../atom';
import { getPlayer } from '../state';
import type { Atom, DamageType, GameState } from '../types';

const ALL_DAMAGE_TYPES: readonly DamageType[] = ['normal', 'fire', 'thunder'];

/** 单一伤害类型免疫（保留原 API） */
export function registerArmorDamageBlock(armorId: string, blockedDamageType: DamageType): void {
  registerArmorDamageBlockMulti(armorId, [blockedDamageType]);
}

/** 多伤害类型免疫 */
export function registerArmorDamageBlockMulti(armorId: string, blockedDamageTypes: readonly DamageType[]): void {
  registerAtomHook({
    atomType: '造成伤害',
    filter(state: GameState, atom: Atom): boolean {
      if (atom.type !== '造成伤害') return false;
      const target = atom.target as string;
      const p = getPlayer(state, target);
      if (!p) return false;
      if (p.equipment.防具 !== armorId) return false;
      const damageType = (atom.damageType as DamageType | undefined) ?? 'normal';
      return blockedDamageTypes.includes(damageType);
    },
    onBefore() {
      return { cancel: true };
    },
  });
}

/** 反向：只防"除 allowedDamageType 之外的所有类型"（大雾防 non-thunder） */
export function registerArmorDamageBlockExcept(armorId: string, allowedDamageType: DamageType): void {
  const blockedTypes = ALL_DAMAGE_TYPES.filter((t) => t !== allowedDamageType);
  registerArmorDamageBlockMulti(armorId, blockedTypes);
}
