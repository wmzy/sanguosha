// @ts-nocheck
// engine/skills/甘宁.ts — 甘宁
import type { SkillDef } from '../types';

// ==================== 甘宁 ====================

export const def: SkillDef = {
    id: '奇袭',
    name: '奇袭',
    description: '你可以将一张黑色手牌当【过河拆桥】使用。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
};
export const def: SkillDef = {
          type: 'prompt',
          text: '奇袭：选择一张黑色手牌和目标角色',
          options: [
            { type: 'selectCards', from: '手牌', min: 1, max: 1 },
            { type: 'selectPlayer' },
          ],
};
export const def: SkillDef = {
          type: 'atoms',
          ops: [
            { type: '弃置', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const },
          ],
};
export const def: SkillDef = {
          type: 'atoms',
          ops: [
            { type: '随机弃置', player: { $: 'ctx', path: 'choice.player' } as const, count: 1, from: '手牌' as const },
          ],
};
    },
  },
];
