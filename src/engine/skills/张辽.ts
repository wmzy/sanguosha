// engine/skills/张辽.ts — 张辽
import type { SkillDef, SkillPhase } from '../types';

export const skills: SkillDef[] = [
  {
    id: '突袭',
    name: '突袭',
    description: '摸牌阶段，你可以放弃摸牌，改为获得最多两名其他角色的各一张手牌。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '摸牌',
      optional: true,
    },
    handler(_ctx, _state) {
      const others = _state.playerOrder.filter(
        n => n !== _ctx.self && _state.players[n].info.alive && _state.players[n].hand.length > 0,
      );
      const targets = others.slice(0, 2);
      if (targets.length === 0) return [];

      const phases: SkillPhase[] = [
        { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '突袭/跳过摸牌', value: true }] },
      ];

      for (const target of targets) {
        phases.push(
          { type: 'atoms', ops: [{ type: '随机弃置', player: target, count: 1, from: '手牌' }] },
          {
            type: 'atoms',
            ops: [{
              type: '获得',
              player: _ctx.self,
              cardId: { $: 'ctx', path: 'localVars.discardedCardId' },
              from: { zone: '弃牌堆' },
            }],
          },
        );
      }

      return phases;
    },
  },
];
