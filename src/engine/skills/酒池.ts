// engine/skills/酒池.ts — 酒池
import type { SkillDef } from '../types';
import { getPlayer, getAlivePlayerNames } from '../state';

export const def: SkillDef = 
  {
    id: '酒池',
    name: '酒池',
    description: '你可以将一张黑桃手牌当【酒】使用。',
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
