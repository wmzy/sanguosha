// engine/skills/火计.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '火计',
  name: '火计',
  description: '你可以将一张红色手牌当【火攻】使用。',
  handler(_ctx, _state) {
    return [];
  },
};
