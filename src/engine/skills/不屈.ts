// engine/skills/不屈.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '不屈',
    name: '不屈',
    description: '锁定技，当你处于濒死状态时，你可以将牌堆顶一张牌作为"创"牌置于武将牌上，若此牌点数与已有的"创"牌均不同，你回复至1体力；否则死亡。',
    trigger: {
      event: '受到伤害',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [];
    },
  };

