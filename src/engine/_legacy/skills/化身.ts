// @ts-nocheck
// engine/skills/化身.ts — 化身（左慈）v2 stub
//
// 阶段 D 删 state.triggers 后 v2 trigger 兜底自然失效——已显式删除。
// 历史 v2 trigger = '回合开始'，handler 空 []。
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '化身',
  name: '化身',
  description: '游戏开始时，你随机获得两张未登场的武将牌作为化身牌，然后亮出其中一张，你获得该化身牌上的一个技能。',
  handler(_ctx, _state) {
    return [];
  },
};