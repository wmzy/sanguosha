// @ts-nocheck
// engine/skills/武圣.ts
import type { SkillDef } from '../types';

export const def: SkillDef =   {
    id: '武圣',
    name: '武圣',
    description: '你可以将一张红色手牌当【杀】使用或打出。',
    // 被动转换 — validate 读此字段（替代 validate.ts:111-118 硬编码）。
    // 武圣 = 任意红色手牌当杀。from: '*' 配合 suit filter 表达。
    convertible: [{
      from: '*',
      to: '杀',
      filter: {
        or: [
          { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♥'] },
          { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♦'] },
        ],
      },
    }],
    handler(_ctx, _state) {
      return [];
    },
  };

