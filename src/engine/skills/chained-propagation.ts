// engine/skills/chained-propagation.ts — 铁索连环（chained 伤害传导）v3 registerAtomHook 实现
//
// 锁定技（占位实现）：受 fire/thunder 伤害时，若目标 chained=true，
// 给同链上其他 chained 角色追加一发同源同型同量 damage（onAfter.additionalAtoms）。
//
// v2 规则：仅 fire/thunder 类型伤害传导；normal 不传导。
//
// 注意（占位实现的已知限制）：
// onAfter.additionalAtoms 走 `applyAtoms(..., { skipHooks: true }, ...)` 递归应用，
// 因此 P1→P3 的反弹**不会再触发本钩子**——即 P3 受反弹伤害时，不会再追加给 P1。
// 这与 v2 真实规则"一次性遍历链上所有角色单次伤害"语义一致；
// 但与 v2 真实规则不完全等价：v2 规则**要求源角色也算进链**（受到源头伤害的角色
// 也应在同链其他成员之间互传），而本占位实现只在"目标 chained=true"时才追加，
// 对源角色本身是否 chained 不做处理。完整语义留 P1-B 收尾。
//
// 本文件不属于角色技能（铁索连环是装备/锦囊效果），不通过 engine/skills/index.ts 启动；

import type { HookRegistry } from '../skill-hook';
import type { Atom, DamageType, GameState } from '../types';

export function register(registry: HookRegistry): void {
  registry.register({
    atomType: '造成伤害',
    filter(_state: GameState, atom: Atom): boolean {
      if (atom.type !== '造成伤害') return false;
      const damageType = (atom.damageType as DamageType | undefined) ?? 'normal';
      // 仅 fire/thunder 传导（v2 规则）
      return damageType === 'fire' || damageType === 'thunder';
    },
    onAfter({ state, atom }: { state: GameState; atom: Atom }) {
      if (atom.type !== '造成伤害') return {};
      const target = atom.target as string;
      const targetPlayer = state.players[target];
      if (!targetPlayer?.chained) return {};

      const amount = atom.amount as number;
      const source = atom.source as string | undefined;
      const damageType = atom.damageType as DamageType | undefined;

      const additionalAtoms: Atom[] = Object.entries(state.players)
        .filter(([name, p]) => p.chained && name !== target)
        .map(([name]) => ({
          type: '造成伤害' as const,
          target: name,
          amount,
          ...(source !== undefined ? { source } : {}),
          ...(damageType !== undefined ? { damageType } : {}),
        }));

      return { additionalAtoms };
    },
  });
}
