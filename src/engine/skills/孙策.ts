// engine/skills/孙策.ts — 孙策
import type { SkillDef } from '../types';

// ==================== 孙策 ====================

export const skills: SkillDef[] = [
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
  {
    id: '魂姿',
    name: '魂姿',
    description: '觉醒技，回合开始阶段，若你的体力为1，你须减1点体力上限，并永久获得技能"英姿"和"英魂"。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '准备',
    },
    handler(_ctx, _state) {
      const p = _state.players[_ctx.self];
      if (p.vars['魂姿/awakened']) return [];
      if (p.health !== 1) return [];

      return [
        { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '魂姿/awakened', value: true }] },
        { type: 'atoms', ops: [{ type: '设上限', player: _ctx.self, delta: -1 }] },
        { type: 'atoms', ops: [{ type: '加技能', player: _ctx.self, skillId: '英姿' }] },
        { type: 'atoms', ops: [{ type: '加技能', player: _ctx.self, skillId: '英魂' }] },
      ];
    },
  },
  {
    id: '制霸',
    name: '制霸',
    description: '主公技，其他吴势力角色的出牌阶段，可与你进行一次拼点。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [];
    },
  },
];
