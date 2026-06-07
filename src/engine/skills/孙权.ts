// engine/skills/孙权.ts — 孙权
import type { SkillDef } from '../types';

// ==================== 孙权 ====================

export const skills: SkillDef[] = [
  {
    id: '制衡',
    name: '制衡',
    description: '出牌阶段，你可以弃置任意数量的牌，然后摸等量的牌。',
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
          text: '制衡：选择要弃置的牌',
          options: [
            { type: 'selectCards', from: '手牌', min: 1, max: 99 },
          ],
        },
        {
          type: 'atoms',
          ops: [
            { type: '弃置', player: _ctx.self, cardIds: { $: 'ctx', path: 'choice.cardIds' } },
          ],
        },
        {
          type: 'atoms',
          ops: [
            { type: '摸牌', player: _ctx.self, count: { $: 'count', source: { $: 'ctx', path: 'choice.cardIds' } } },
          ],
        },
      ];
    },
  },
  {
    id: '救援',
    name: '救援',
    description: '锁定技，其他吴势力角色对你使用【桃】时，你额外回复1点体力。',
    trigger: {
      event: '回复体力',
      source: '角色',
    },
    handler(_ctx, _state) {
      const source = _ctx.source;
      if (!source || source === _ctx.self) return [];
      if (_ctx.target !== _ctx.self) return [];
      const sourcePlayer = _state.players[source];
      if (!sourcePlayer?.info?.faction || sourcePlayer.info.faction !== '吴') return [];
      return [
        { type: 'atoms', ops: [{ type: '回复体力', target: _ctx.self, amount: 1 }] },
      ];
    },
  },
];
