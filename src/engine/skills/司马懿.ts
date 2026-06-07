// engine/skills/司马懿.ts — 司马懿
import type { SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '反馈',
    name: '反馈',
    description: '当你受到伤害后，你可以获得伤害来源的一张牌。',
    trigger: {
      event: '受到伤害',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      if (!_ctx.source) return [];
      const sourcePlayer = _state.players[_ctx.source];
      if (!sourcePlayer || sourcePlayer.hand.length === 0) return [];
      return [
        {
          type: 'atoms',
          ops: [
            { type: '随机弃置', player: _ctx.source, count: 1, from: '手牌' },
          ],
        },
        {
          type: 'atoms',
          ops: [
            {
              type: '获得',
              player: _ctx.self,
              cardId: { $: 'ctx', path: 'localVars.discardedCardId' },
              from: { zone: '弃牌堆' },
            },
          ],
        },
      ];
    },
  },

  {
    id: '鬼才',
    name: '鬼才',
    description: '当一张判定牌生效前，你可以打出一张手牌代替之。',
    trigger: {
      event: '判定结果',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      return [
        {
          type: 'prompt',
          text: '鬼才：是否用手牌替换判定牌？',
          options: [
            { label: '不替换', value: false },
            { type: '选择牌', from: '手牌', min: 1, max: 1 },
          ],
          defaultChoice: false,
        },
        {
          type: 'condition',
          check: { notEquals: [{ $: 'ctx', path: 'choice' }, false] },
          then: [
            // 将原判定牌从弃牌堆移回牌堆
            {
              type: 'atoms',
              ops: [{
                type: '移动牌',
                cardId: _ctx.sourceCard!,
                from: { zone: '弃牌堆' },
                to: { zone: '牌堆' },
              }],
            },
            // 将选择的手牌移到弃牌堆作为新的判定结果
            {
              type: 'atoms',
              ops: [{
                type: '移动牌',
                cardId: { $: 'ctx', path: 'choice' },
                from: { zone: '手牌', player: _ctx.self },
                to: { zone: '弃牌堆' },
              }],
            },
          ],
        },
      ];
    },
  },
];
