// engine/skills/夏侯惇.ts — 夏侯惇
import type { SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '刚烈',
    name: '刚烈',
    description: '当你受到伤害后，你可以进行判定：若结果不为♥，伤害来源弃置两张手牌或受到1点伤害。',
    trigger: {
      event: '受到伤害',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      if (!_ctx.source) return [];
      return [
        { type: 'atoms', ops: [{ type: '判定', player: _ctx.self }] },
        {
          type: 'condition',
          check: { notEquals: [{ $: 'ctx', path: 'localVars.judgeSuit' }, '♥'] },
          then: [
            { type: 'atoms', ops: [{ type: '造成伤害', target: _ctx.source, amount: 1 }] },
            { type: 'checkDying', player: _ctx.source },
          ],
        },
      ];
    },
  },
];
