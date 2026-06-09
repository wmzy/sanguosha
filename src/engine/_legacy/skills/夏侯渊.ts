// engine/skills/夏侯渊.ts — 夏侯渊
import type { SkillDef } from '../types';
import { getPlayer } from '../state';
import { getSkillConvertedCards } from '../validate';

export const skills: SkillDef[] = [
  {
    id: '神速',
    name: '神速',
    description: '你可以选择以下一至两项：1.跳过判定阶段和摸牌阶段；2.跳过出牌阶段并弃置一张装备牌。你每选择一项，视为对一名其他角色使用一张无距离限制的【杀】。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '判定',
      optional: true,
      manual: true,
    },
    handler(_ctx, _state) {
      const target = _ctx.target;
      if (!target) return [];

      const targetPlayer = getPlayer(_state, target);
      if (!targetPlayer.info.alive) return [];

      const literalDodge = targetPlayer.hand.filter(
        (id) => _state.cardMap[id]?.name === '闪',
      );
      const skillDodge = getSkillConvertedCards(_state, target, '闪');
      const validCards = [...new Set([...literalDodge, ...skillDodge])];

      return [
        {
          type: '打出',
          window: {
            type: 'killResponse',
            attacker: _ctx.self,
            defender: target,
            validCards,
          },
        },
      ];
    },
  },
];
