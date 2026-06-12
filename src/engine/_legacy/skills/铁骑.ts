// @ts-nocheck
// engine/skills/铁骑.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '铁骑',
  name: '铁骑',
  description: '当你使用【杀】指定一名角色为目标后，你可以进行判定：若结果为红色，该角色不能使用【闪】。',
  trigger: {
    event: '出牌',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    if (!_ctx.sourceCard) return [];
    const card = _state.cardMap[_ctx.sourceCard];
    if (card?.name !== '杀') return [];
    if (!_ctx.target) return [];
    return [
      { type: 'atoms', ops: [{ type: '判定', player: _ctx.self }] },
      {
        type: 'condition',
        check: { equals: [{ $: 'ctx', path: 'localVars.judgeColor' }, 'red'] },
        then: [
          { type: 'atoms', ops: [{ type: '加标签', player: _ctx.target, tag: 'cannotDodge' }] },
        ],
      },
    ];
  },
};
