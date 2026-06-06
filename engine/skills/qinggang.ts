// engine/skills/qinggang.ts — 青釭剑（武器）v3 registerAtomHook 实现
//
// 武器技（占位实现）：装备青釭剑的角色造成【杀】伤害时，无视目标防具。
//
// v3 路径：监听 `damage` 原子。source === 装备 .weapon === 'qinggang' 时，
// 通过 additionalAtoms 注入 setCtxVar { key: 'penetrateArmor', value: true }，
// 由后续防具（藤甲/仁王盾）钩子读取并跳过防具效果。
//
// 注：本 Task 仅实现 v3 钩子骨架，装备注册（cardId 映射、装备区放置）由 P1-D 处理。
// 旧 stub handler 空壳保留在 engine/skills/equipment.ts（trigger 改为 v3HookOnly 占位）。
//
// 完整防具判断（target 防具类型 + 穿透后取消防具效果）留 P2。
// 现阶段：v3 钩子只负责打标 'penetrateArmor'，藤甲/仁王盾钩子 P2 读取该 ctx var 后
// 选择是否取消防具效果。
//
// TODO(P1-D): migrate to weaponId — 当前 weaponId 字面量 'qinggang'
// 应当由 cardId '青釭剑' 经 P1-D 装备 barrel 解析得到，不再是裸字符串。
// TODO(P2): 完整化：藤甲/仁王盾钩子读取 penetrateArmor 后选择是否取消防具效果。

import { registerAtomHook } from '../atom';
import { getPlayer } from '../state';
import type { Atom, GameState } from '../types';

const QINGGANG_ID = 'qinggang';

export function register(): void {
  registerAtomHook({
    atomType: 'damage',
    filter(state: GameState, atom: Atom): boolean {
      if (atom.type !== 'damage') return false;
      const source = atom.source as string | undefined;
      if (!source) return false;
      const p = getPlayer(state, source);
      if (!p) return false;
      return p.equipment.weapon === QINGGANG_ID;
    },
    // 标记穿透：onAfter 注入 setCtxVar(penetrateArmor=true)
    // (onBefore 不支持 additionalAtoms；onAfter 是 supported 路径)
    // 由后续防具（藤甲/仁王盾）钩子读取并跳过防具效果。
    onAfter() {
      return {
        additionalAtoms: [{ type: 'setCtxVar', key: 'penetrateArmor', value: true }],
      };
    },
  });
}
