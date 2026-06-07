// engine/skills/张昭张纮.ts — 张昭张纮
import type { SkillDef } from '../types';

// ==================== 张昭张纮 ====================

export const skills: SkillDef[] = [
  {
    id: '直谏',
    name: '直谏',
    description: '出牌阶段，你可以将手牌中的一张装备牌置于一名其他角色的装备区（不得替换原装备），然后摸一张牌。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [
        {
          type: 'prompt',
          text: '直谏：选择一张装备牌和目标角色',
          options: [
            { type: 'selectCards', from: '手牌', min: 1, max: 1 },
            { type: 'selectPlayer' },
          ],
        },
        {
          type: 'atoms',
          ops: [
            { type: '装备', player: { $: 'ctx', path: 'choice.player' } as const, cardId: { $: 'ctx', path: 'choice.cardIds.0' } as const },
          ],
        },
        {
          type: 'atoms',
          ops: [
            { type: '摸牌', player: _ctx.self, count: 1 },
          ],
        },
      ];
    },
  },
  {
    id: '固政',
    name: '固政',
    description: '其他角色的弃牌阶段结束时，你可以将弃牌堆中一张该角色弃置的牌返回其手牌，然后获得其余弃牌。',
    trigger: {
      event: '阶段结束',
      source: '角色',
    },
    handler(_ctx, _state) {
      return [];
    },
  },
];
