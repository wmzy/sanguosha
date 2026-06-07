// engine/skills/zhangba.ts — 丈八蛇矛（武器）v3 registerAtomHook 实现
//
// 武器技（占位实现）：装备丈八蛇矛的角色可以将两张手牌当【杀】使用。
//
// v3 路径：监听 `specifyTarget` 原子（useCard 三原子拆分 P1-A 已上线）。
// source = 装备 .武器 === '丈八蛇矛' + card.name === '杀' +
// source.hand.length >= 2 → 提示选 2 张手牌当杀。
//
// 注：本 Task 仅实现 v3 钩子骨架，装备注册（cardId 映射、装备区放置）由 P1-D 处理。
// 旧 stub handler 空壳保留在 engine/skills/equipment.ts（trigger 改为 v3HookOnly 占位）。
//
// 完整多步 prompt（选 2 张手牌）接入留 P2。
// 当前占位：onBefore 不过滤、不取消，仅留接口 + TODO 注释指向完整实现。
//
// TODO(P1-D): migrate to weaponId — 当前 weaponId 字面量 '丈八蛇矛'
// 应当由 cardId '丈八蛇矛' 经 P1-D 装备 barrel 解析得到，不再是裸字符串。
// TODO(P2): 接入 multiStep prompt 选 2 张手牌当【杀】。

import type { HookRegistry } from '../skill-hook';
import { getPlayer } from '../state';
import type { Atom, GameState, SkillDef } from '../types';

const ZHANGBA_ID = '丈八蛇矛';

export const skills: SkillDef[] = [
  {
    id: ZHANGBA_ID,
    name: ZHANGBA_ID,
    description: '武器技：装备丈八蛇矛的角色可以将两张手牌当【杀】使用。',
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: '指定目标',
        filter(state: GameState, atom: Atom): boolean {
          if (atom.type !== '指定目标') return false;
          const cardId = atom.cardId as string;
          const card = state.cardMap[cardId];
          if (card?.name !== '杀') return false;
          const source = atom.source as string;
          const p = getPlayer(state, source);
          if (!p) return false;
          if (p.equipment.武器 !== ZHANGBA_ID) return false;
          return p.hand.length >= 2;
        },
        onBefore() {
          // TODO: 接入 multiStep prompt 选 2 张手牌
          // 本 Task 留接口，由 P2 完整化
          return {};
        },
      });
    },
  },
];
