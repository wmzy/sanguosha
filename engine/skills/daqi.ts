// engine/skills/daqi.ts — 大雾（神诸葛亮技能）v3 registerAtomHook 实现
//
// 神诸葛亮"大雾"标记：防止受到的所有非雷电伤害。
//
// v3 路径（Task 2 范围）：监听 `damage` 原子。目标 = 装备.armor === 'daqi' + damageType === 'thunder'
// → 取消该 atom（不 apply、不写 serverLog）。
//
// 注：本 Task 仅实现 thunder 免疫 v3 钩子骨架。完整大雾"非雷电全部防止"
// 涉及 chained 状态（[T-12] P1-B），留 P1-B 一并实现。
// 大雾为 Mark-style 技能（不是装备），本 Task 走 fixture 模拟
// "目标拥有大雾 = equipment.armor === 'daqi'"——与藤甲对称实现。

import { registerAtomHook } from '../atom';
import { getPlayer } from '../state';
import type { Atom, GameState, DamageType } from '../types';

const DAQI_ID = 'daqi';

export function register(): void {
  registerAtomHook({
    atomType: 'damage',
    filter(state: GameState, atom: Atom): boolean {
      if (atom.type !== 'damage') return false;
      const target = atom.target as string;
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.equipment.armor !== DAQI_ID) return false;
      const damageType = (atom.damageType as DamageType | undefined) ?? 'normal';
      return damageType === 'thunder';
    },
    onBefore() {
      return { cancel: true };
    },
  });
}
