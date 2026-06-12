// @ts-nocheck
// engine/skills/fangtian.ts — 方天画戟（武器）v3 registerAtomHook 实现
//
// 武器技（占位实现）：装备方天画戟且手牌数为 0 的角色使用【杀】可以指定最多三名角色为目标。
//
// v3 路径：监听 `specifyTarget` 原子。source = 装备 .武器 === '方天画戟' +
// source.hand.length === 0 → onAfter 追加 1-2 个 specifyTarget（最多 3 个目标）。
//
// 注：本 Task 仅实现 v3 钩子骨架，装备注册（cardId 映射、装备区放置）由 P1-D 处理。
// 旧 stub handler 空壳保留在 engine/skills/equipment.ts（trigger 改为 v3HookOnly 占位）。
//
// 完整多目标 prompt（选 1-2 个追加目标）接入留 P2。
// 当前占位：filter 仅在 hand=0 时匹配，onAfter 不追加任何目标。
//
// TODO(P1-D): migrate to weaponId — 当前 weaponId 字面量 '方天画戟'
// 应当由 cardId '方天画戟' 经 P1-D 装备 barrel 解析得到，不再是裸字符串。
// TODO(P2): 接入 multiStep prompt 选 1-2 个追加目标。

import type { HookRegistry } from '../skill-hook';
import { getPlayer } from '../state';
import type { Atom, GameState, SkillDef } from '../types';

const FANGTIAN_ID = '方天画戟';

export const skills: SkillDef[] = [
  {
    id: FANGTIAN_ID,
    name: FANGTIAN_ID,
    description:
      '武器技：装备方天画戟且手牌数为 0 的角色使用【杀】可以指定最多三名角色为目标。',
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: '指定目标',
        filter(state: GameState, atom: Atom): boolean {
          if (atom.type !== '指定目标') return false;
          const source = atom.source as string;
          const p = getPlayer(state, source);
          if (!p) return false;
          if (p.equipment.武器 !== FANGTIAN_ID) return false;
          if (p.hand.length !== 0) return false; // 方天画戟：手牌为 0 时多目标
          return true;
        },
        onAfter() {
          // 追加 1-2 个 specifyTarget（最多 3 个目标）
          // 简化：暂只追加 0 个，留 P2 prompt 选目标
          return {};
        },
      });
    },
  },
];
