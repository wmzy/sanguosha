// engine/skills/缔盟.ts — 缔盟
import type { SkillDef, SkillPhase } from '../types';
import { getPlayer } from '../state';

export const def: SkillDef = 
  {
    id: '缔盟',
    name: '缔盟',
    description: '出牌阶段，你可以选择两名其他角色，弃置等同于这两名角色手牌数差的牌，然后交换他们的手牌。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [];
    },
  },
