// @ts-nocheck
// engine/skills/郭嘉.ts — 郭嘉
import type { SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '天妒',
    name: '天妒',
    description: '当你的判定牌生效后，你可以获得此判定牌。',
    trigger: {
      event: '判定结果',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      // ctx.sourceCard = 判定牌 ID
      if (!_ctx.sourceCard) return [];
      return [
        {
          type: 'atoms',
          ops: [
            {
              type: '获得',
              player: _ctx.self,
              cardId: _ctx.sourceCard,
              from: { zone: '弃牌堆' },
            },
          ],
        },
      ];
    },
  },
  {
    id: '遗计',
    name: '遗计',
    description: '当你受到1点伤害后，你可以摸两张牌。',
    // v3 registerAtomHook 实现：监听 `造成伤害` atom onAfter，
    // filter 收窄到「自己是有遗计的角色」+「受到伤害」，
    // onAfter 注入「摸 2 张」atom。
    // 原 v2 handler 中的「分配给其他角色」为 C 类（含 prompt/foreach），
    // 在 v3 registerAtomHook 中无法实现，已删除。
    registerHooks(registry) {
      registry.register({
        atomType: '造成伤害',
        filter: (state, atom) => {
          if (atom.type !== '造成伤害') return false;
          const target = atom.target as string;
          return state.players[target]?.skills?.includes('遗计') ?? false;
        },
        onAfter: ({ atom }) => {
          const target = atom.target as string;
          return {
            additionalAtoms: [{ type: '摸牌', player: target, count: 2 }],
          };
        },
      });
    },
  },
];
