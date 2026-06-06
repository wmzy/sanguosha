// engine/skills/tengjia.ts — 藤甲（防具）v3 registerAtomHook 实现
//
// 锁定技：装备藤甲的角色受到火焰伤害时，防止此伤害。
//
// v3 路径：监听 `damage` 原子。目标 = 装备.armor === 'tengjia' + damageType === 'fire'
// → 取消该 atom（不 apply、不写 serverLog）。
//
// 注：本 Task 仅实现 v3 钩子骨架，装备注册（cardId 映射、装备区放置）由 P1-D 处理。
// 旧 stub handler 空壳未注册（`engine/skills/equipment.ts` 暂不含 tengjia）。

import { registerAtomHook } from '../atom';
import { getPlayer } from '../state';
import type { Atom, GameState, DamageType } from '../types';

const TENGJIA_ID = 'tengjia';

export function register(): void {
  registerAtomHook({
    atomType: 'damage',
    filter(state: GameState, atom: Atom): boolean {
      if (atom.type !== 'damage') return false;
      const target = atom.target as string;
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.equipment.armor !== TENGJIA_ID) return false;
      const damageType = (atom.damageType as DamageType | undefined) ?? 'normal';
      return damageType === 'fire';
    },
    onBefore() {
      // 藤甲：fire 伤害全防
      return { cancel: true };
    },
  });
}
