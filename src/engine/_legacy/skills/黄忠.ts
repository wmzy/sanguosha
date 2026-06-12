// @ts-nocheck
// engine/skills/黄忠.ts — 黄忠
import type { SkillDef } from '../types';

// ==================== 黄忠 ====================

export const skills: SkillDef[] = [
  {
    id: '烈弓',
    name: '烈弓',
    description: '当你使用【杀】指定目标后，若其手牌数≥你或体力值≥你，其不能使用【闪】。',
    trigger: {
      event: '出牌',
      source: '角色',
    },
    handler(_ctx, _state) {
      if (!_ctx.target || !_ctx.sourceCard) return [];
      const card = _state.cardMap[_ctx.sourceCard];
      if (card?.name !== '杀') return [];
      if (_ctx.target === _ctx.self) return [];

      const me = _state.players[_ctx.self];
      const target = _state.players[_ctx.target];
      if (!me || !target) return [];

      const targetHandGte = target.hand.length >= me.hand.length;
      const targetHpGte = target.health >= me.health;

      if (!targetHandGte && !targetHpGte) return [];

      return [
        { type: 'atoms', ops: [{ type: '加标签', player: _ctx.target, tag: 'cannotDodge' }] },
      ];
    },
  },
];
