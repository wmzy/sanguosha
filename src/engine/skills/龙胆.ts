// engine/skills/龙胆.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '龙胆',
    name: '龙胆',
    description: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。',
    trigger: {
      event: 'killResponse',
      source: '角色',
      manual: true,
      optional: true,
    },
    // 双向转换（数组形式）：杀→闪 + 闪→杀
    convertible: [
      { from: '杀', to: '闪' },
      { from: '闪', to: '杀' },
    ],
    handler(_ctx, _state) {
      return [];
    },
  };

