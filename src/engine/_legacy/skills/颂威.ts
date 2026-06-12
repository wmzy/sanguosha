// @ts-nocheck
// engine/skills/颂威.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '颂威',
  name: '颂威',
  description: '其他魏势力角色的判定牌结果为黑色且生效后，可以让你摸一张牌。',
  trigger: {
    event: '判定结果',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const e = _ctx.event as Record<string, unknown> | undefined;
    const result = e?.['result'] as string | undefined;
    if (result !== 'black') return [];

    const judgePlayer = e?.['player'] as string | undefined;
    if (!judgePlayer || judgePlayer === _ctx.self) return [];

    const judgePlayerState = _state.players[judgePlayer];
    if (judgePlayerState?.info.faction !== '魏') return [];

    return [
      { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
    ];
  },
};
