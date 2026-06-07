// engine/skills/节命.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '节命',
  name: '节命',
  description: '当你受到1点伤害后，你可以令一名角色将手牌摸至X张（X为其体力上限且最多为5）。',
  trigger: {
    event: '受到伤害',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const selfPlayer = _state.players[_ctx.self];
    const drawCount = Math.min(selfPlayer.maxHealth, 5) - selfPlayer.hand.length;
    if (drawCount <= 0) return [];
    return [
      { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: Math.min(drawCount, 5) }] },
    ];
  },
};
