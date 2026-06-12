// @ts-nocheck
// engine/skills/董卓.ts — 董卓
import type { SkillDef } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';

// ==================== 董卓 ====================

export const skills: SkillDef[] = [
  {
    id: '酒池',
    name: '酒池',
    description: '你可以将一张黑桃手牌当【酒】使用。',
    handler(_ctx, _state) {
      return [];
    },
  },
  {
    id: '肉林',
    name: '肉林',
    description: '锁定技，你对女性角色/女性角色对你使用【杀】时，需连续使用两张【闪】才能抵消。',
    handler(_ctx, _state) {
      return [];
    },
  },
  {
    id: '崩坏',
    name: '崩坏',
    description: '锁定技，回合结束阶段，若你的体力不是全场最少的（或同时为最少），你须减1点体力或1点体力上限。',
    trigger: {
      event: '回合结束',
      source: '角色',
    },
    handler(ctx, state) {
      const self = getPlayer(state, ctx.self);
      const aliveNames = getAlivePlayerNames(state);
      const minHealth = Math.min(...aliveNames.map(n => getPlayer(state, n).health));

      if (self.health <= minHealth) return [];

      return [
        {
          type: 'prompt' as const,
          text: '崩坏：减1点体力或减1点体力上限',
          options: [
            { label: '减1点体力', value: 'health' },
            { label: '减1点体力上限', value: 'maxHealth' },
          ],
        },
      ];
    },
  },
  {
    id: '暴虐',
    name: '暴虐',
    description: '主公技，其他群雄角色每造成一次伤害，可进行一次判定，若结果为黑桃，你回复1点体力。',
    handler(_ctx, _state) {
      return [];
    },
  },
  {
    id: '乱武',
    name: '乱武',
    description: '限定技，出牌阶段，你可以令所有其他角色依次对与其距离最近的另一名角色使用一张【杀】，无法如此做者失去1点体力。',
    handler(_ctx, _state) {
      return [];
    },
  },
];
