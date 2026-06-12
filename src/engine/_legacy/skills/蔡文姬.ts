// @ts-nocheck
// engine/skills/蔡文姬.ts — 蔡文姬
import type { SkillDef } from '../types';
import type { HookRegistry } from '../skill-hook';

// ==================== 蔡文姬 ====================

export const skills: SkillDef[] = [
  {
    id: '悲歌',
    name: '悲歌',
    description: '当一名角色受到【杀】造成的伤害后，你可以弃置一张牌，然后令该角色判定，根据判定结果执行效果。',
    // v3 registerAtomHook 实现：监听 `造成伤害` atom onAfter，
    // filter 收窄到「伤害来源的 cardId 指向【杀】」+「自己有悲歌技能」+「有手牌可弃」，
    // onAfter 注入「判定」原子（v3 不能跨 atom 做条件分支，简化：只追加判定）。
    // 原 v2 handler 内的「弃 1 张牌 + 判定结果条件分支」为 C 类（含 prompt/condition），
    // v3 registerAtomHook 无法实现，已删除。
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: '造成伤害',
        filter: (state, atom) => {
          if (atom.type !== '造成伤害') return false;
          const cardId = atom.cardId as string | undefined;
          if (!cardId) return false;
          if (state.cardMap[cardId]?.name !== '杀') return false;
          // 找拥有悲歌技能且有手牌的角色
          for (const playerId of state.playerOrder) {
            const p = state.players[playerId];
            if (p.skills?.includes('悲歌') && p.hand.length > 0) return true;
          }
          return false;
        },
        onAfter: ({ atom }) => {
          const target = atom.target as string;
          return {
            additionalAtoms: [{ type: '判定', player: target }],
          };
        },
      });
    },
  },
  {
    id: '断肠',
    name: '断肠',
    description: '锁定技，杀死你的角色立即失去所有技能直到游戏结束。',
    handler(_ctx, _state) {
      return [];
    },
  },
];
