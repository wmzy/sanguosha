// engine/skills/_armorDamageBlock.ts — 装备防具：单一伤害类型免疫钩子
//
// 藤甲/大雾这类"装备防具 + 防特定伤害类型"的对称实现。
// tengjia.ts 和 daqi.ts 各自调用 registerArmorDamageBlock(armorId, blockedDamageType)
// 即可注册一个 cancel 该类型伤害的 hook。
//
// 设计：与 kongcheng.ts 一致—— filter 阶段做 null-guard + 范围窄化，
// onBefore 仅做最终拦截（{ cancel: true }）。

import { registerAtomHook } from '../atom';
import { getPlayer } from '../state';
import type { Atom, DamageType, GameState } from '../types';

export function registerArmorDamageBlock(armorId: string, blockedDamageType: DamageType): void {
  registerAtomHook({
    atomType: 'damage',
    filter(state: GameState, atom: Atom): boolean {
      if (atom.type !== 'damage') return false;
      const target = atom.target as string;
      const p = getPlayer(state, target);
      if (!p) return false;
      if (p.equipment.armor !== armorId) return false;
      const damageType = (atom.damageType as DamageType | undefined) ?? 'normal';
      return damageType === blockedDamageType;
    },
    onBefore() {
      return { cancel: true };
    },
  });
}
