// engine/skills/关羽.ts — 关羽
import type { SkillDef } from '../types';

// ==================== 关羽 ====================

export const def: SkillDef = {
    id: '武圣',
    name: '武圣',
    description: '你可以将一张红色手牌当【杀】使用或打出。',
    trigger: {
      event: 'killResponse',
      source: '角色',
      manual: true,
      optional: true,
};
export const def: SkillDef = {
  equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♥'] },
          { equals: [{ $: 'cardProp', card: { $: 'ctx', path: 'localVars.cardId' }, prop: 'suit' }, '♦'] },
        ],
};
