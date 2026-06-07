// engine/skills/激昂.ts — 激昂
import type { SkillDef } from '../types';

export const def: SkillDef = 
  {
    id: '激昂',
    name: '激昂',
    description: '每当你使用（指定目标后）或被使用（成为目标后）一张【决斗】或红色的【杀】时，你可以摸一张牌。',
    trigger: {
      event: '出牌',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      if (!_ctx.sourceCard) return [];
      const card = _state.cardMap[_ctx.sourceCard];
      if (!card) return [];

      const isDuel = card.name === '决斗';
      const isRedKill = card.name === '杀' && (card.suit === '♥' || card.suit === '♦');

      if (!isDuel && !isRedKill) return [];

      const event = _ctx.event;
      const isUser = event && 'player' in event && _ctx.self === event.player;
      const isTarget = _ctx.target === _ctx.self;

      if (!isUser && !isTarget) return [];

      return [
        { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 1 }] },
      ];
    },
  },
