// engine/skills/新生.ts — 新生（左慈）v2 stub
//
// 阶段 D 删 state.triggers 后 v2 trigger 兜底自然失效——已显式删除。
// 历史 v2 trigger = '受到伤害'，handler 空 []。
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '新生',
  name: '新生',
  description: '每当你受到1点伤害后，你可以获得一张新的化身牌。',
  handler(_ctx, _state) {
    return [];
  },
};