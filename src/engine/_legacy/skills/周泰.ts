// @ts-nocheck
// engine/skills/周泰.ts — 周泰 v2 stub
//
// 阶段 D 删 state.triggers 后 v2 trigger 兜底自然失效——已显式删除。
// 不屈（周泰）历史 v2 trigger = '受到伤害'，handler 空 []。
import type { SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '不屈',
    name: '不屈',
    description: '锁定技，当你处于濒死状态时，你可以将牌堆顶一张牌作为"创"牌置于武将牌上，若此牌点数与已有的"创"牌均不同，你回复至1体力；否则死亡。',
    handler(_ctx, _state) {
      return [];
    },
  },
];