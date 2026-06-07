// engine/skills/行殇.ts
import type { SkillDef, SkillPhase } from '../types';

export const def: SkillDef = {
  id: '行殇',
  name: '行殇',
  description: '你可以立即获得死亡角色的所有牌。',
  trigger: {
    event: '死亡',
    source: '角色',
    optional: true,
  },
  handler(_ctx, _state) {
    const e = _ctx.event as Record<string, unknown> | undefined;
    const deadPlayer = (e?.['player'] as string) ?? _ctx.target;
    if (!deadPlayer) return [];

    const dead = _state.players[deadPlayer];
    if (!dead) return [];

    const phases: SkillPhase[] = [];

    for (const cardId of dead.hand) {
      phases.push({
        type: 'atoms',
        ops: [{
          type: '获得',
          player: _ctx.self,
          cardId,
          from: { zone: '弃牌堆' },
        }],
      });
    }

    return phases;
  },
};
