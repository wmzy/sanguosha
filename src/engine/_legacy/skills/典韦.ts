// @ts-nocheck
// engine/skills/典韦.ts — 典韦
import type { Atom, SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '强袭',
    name: '强袭',
    description: '出牌阶段，你可以自减1点体力或弃一张武器牌，对攻击范围内的一名角色造成1点伤害。每回合限一次。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      optional: true,
      manual: true,
    },
    handler(_ctx, _state) {
      const selfPlayer = _state.players[_ctx.self];
      if (!selfPlayer || selfPlayer.health <= 0) return [];

      const target = _ctx.target;
      if (!target) return [];

      const ops: Atom[] = [
        { type: '造成伤害', target: _ctx.self, amount: 1 },
        { type: '造成伤害', target, amount: 1 },
      ];

      return [
        { type: 'atoms', ops },
        { type: 'checkDying', player: _ctx.self },
        { type: 'checkDying', player: target },
      ];
    },
  },
];
