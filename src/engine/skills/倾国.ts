// engine/skills/倾国.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '倾国',
    name: '倾国',
    description: '你可以将一张黑色手牌当【闪】使用或打出。',
    trigger: {
      event: 'killResponse',
      source: '角色',
      manual: true,
      optional: true,
    },
    // 被动转换 — validate 读此字段（替代 validate.ts:111-118 硬编码）。
    // 倾国 = 任意黑色手牌当闪。from: '*' 配合 suit filter 表达。
    convertible: [{
      from: '*',
      to: '闪',
      filter: {
        or: [
          { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♠'] },
          { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♣'] },
        ],
      },
    }],
    handler(_ctx, _state) {
      // 被动转换技能 — 在 validation 层处理黑色手牌→闪的转换
      return [];
    },
  };

