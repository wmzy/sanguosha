// engine/skills/bagua.ts — 八卦阵（防具）v3 registerAtomHook 实现
//
// 锁定技（占位实现）：装备八卦阵的角色受到【杀】造成的伤害时，防止此伤害。
//
// v3 路径：监听 `damage` 原子。目标 = 装备.armor === 'bagua'
// + damage.cardId 指向一张【杀】 → 取消该 atom（不 apply、不写 serverLog）。
//
// 注：本 Task 仅实现 v3 钩子骨架，装备注册（cardId 映射、装备区放置）由 P1-D 处理。
// 旧 stub handler 空壳保留在 engine/skills/equipment.ts（trigger 改为 v3HookOnly 占位）。
//
// 完整判定（红色视为闪、黑色不视为闪）走 useCard 三原子钩子（specifyTarget/becomeTarget
// /resolveCard）实现，留 P2。本 Task 给出"damage onBefore cancel"占位 + TODO 注释指向完整实现。
//
// 真实游戏逻辑：八卦阵需要先判定，红色则视为成功打出【闪】从而根本不会进入 damage；
// 黑色则需要继续出【闪】。本占位实现**总是视为成功**（damage 被 cancel）。
// 一旦 useCard 钩子完整判定走通，可去掉此兜底——届时此文件退化为空或删除。
//
// TODO(P1-D): migrate to armorEffect — 当前 armorId 字面量 'bagua'
// 应当由 cardId '八卦阵' 经 P1-D 装备 barrel 解析得到，不再是裸字符串。
// TODO(P2): replace placeholder with full judge-based implementation.

import { registerAtomHook } from '../atom';
import { getPlayer } from '../state';
import type { Atom, GameState } from '../types';

const BAGUA_ID = 'bagua';

export function register(): void {
  registerAtomHook({
    atomType: 'damage',
    filter(state: GameState, atom: Atom): boolean {
      if (atom.type !== 'damage') return false;
      const cardId = atom.cardId as string | undefined;
      if (!cardId) return false;
      if (state.cardMap[cardId]?.name !== '杀') return false;
      const target = atom.target as string;
      const p = getPlayer(state, target);
      if (!p) return false;
      return p.equipment.armor === BAGUA_ID;
    },
    onBefore() {
      // 完整判定走 useCard 钩子（留 P2）
      // 现阶段：v3 钩子兜底 cancel 视为"八卦阵总是生效"
      return { cancel: true };
    },
  });
}
