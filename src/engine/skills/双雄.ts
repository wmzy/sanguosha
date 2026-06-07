// engine/skills/双雄.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '双雄',
    name: '双雄',
    description: '摸牌阶段，你可以放弃摸牌，改为展示牌堆顶两张牌并选择其中一张，然后本回合你可以将一张与此牌同花色的手牌当【决斗】使用。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '摸牌',
      optional: true,
    },
    handler(_ctx, _state) {
      return [];
    },
  };

