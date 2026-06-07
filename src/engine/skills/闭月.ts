// engine/skills/闭月.ts — 闭月（貂蝉）
//
// 阶段 B-1：[P5-T2] 双源时期示范——v2 trigger.event + v3 registerAtomHook 并行。
// v3 钩子监听 `阶段结束` atom onAfter，filter 收窄到「自己回合结束 + characterId==貂蝉」，
// 摸 1 张牌作为 additionalAtoms。
// v2 trigger.event 保留作为兜底，确保任一路径失效都不破坏技能。
// 阶段 D 删 state.triggers 字段时，v2 trigger.event 兜底自然失效。

import type { SkillDef, GameState, Atom } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';

export const def: SkillDef =
  {
    id: '闭月',
    name: '闭月',
    description: '结束阶段，你可以摸一张牌。',
    registerHooks(registry) {
      registry.register({
        atomType: '阶段结束',
        filter: (state: GameState, atom: Atom) => {
          if ((atom as Atom & { type: '阶段结束' }).phase !== '结束') return false;
          const player = (atom as Atom & { type: '阶段结束' }).player as string;
          return state.players[player]?.info.characterId === '貂蝉';
        },
        onAfter: ({ atom }) => {
          const player = (atom as Atom & { type: '阶段结束' }).player as string;
          return {
            additionalAtoms: [
              { type: '摸牌', player, count: 1 },
            ],
          };
        },
      });
    },
    // v2 兜底：保留 trigger.event 让 emitEvent 派发仍能触发（51 个 v2 老技能并行期）
    trigger: {
      event: '回合结束',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
      ];
    },
  },
