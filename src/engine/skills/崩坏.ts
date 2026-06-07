// engine/skills/崩坏.ts — 崩坏
import type { SkillDef } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';

export const def: SkillDef = 
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
