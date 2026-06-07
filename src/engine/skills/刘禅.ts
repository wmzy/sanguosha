// engine/skills/刘禅.ts — 刘禅
import type { SkillDef } from '../types';

// ==================== 刘禅（山扩展包）====================

export const skills: SkillDef[] = [
  {
    id: '享乐',
    name: '享乐',
    description: '锁定技，当其他角色使用【杀】指定你为目标时，需额外弃置一张基本牌，否则该【杀】对你无效。',
    trigger: {
      event: '出牌',
      source: '角色',
    },
    handler(_ctx, _state) {
      if (!_ctx.sourceCard) return [];
      const card = _state.cardMap[_ctx.sourceCard];
      if (card?.name !== '杀') return [];
      if (!_ctx.target || _ctx.target !== _ctx.self) return [];
      const attacker = (_ctx.event as Record<string, unknown>)['player'] as string;
      if (!attacker || attacker === _ctx.self) return [];
      return [
        { type: 'atoms', ops: [{ type: '加标签', player: attacker, tag: '享乐/discardBasic' }] },
      ];
    },
  },

  {
    id: '放权',
    name: '放权',
    description: '你可以跳过出牌阶段，然后在回合结束时弃置一张手牌，令一名其他角色进行一个额外回合。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      return [
        {
          type: 'prompt',
          text: '放权：是否跳过出牌阶段？',
          options: [
            { label: '跳过出牌阶段', value: true },
            { label: '取消', value: false },
          ],
          defaultChoice: false,
        },
      ];
    },
  },

  {
    id: '若愚',
    name: '若愚',
    description: '主公技，觉醒技，回合开始阶段，若你的体力是全场最少的（或之一），你须增加1点体力上限并回复1点体力，然后永久获得技能"激将"。',
    trigger: {
      event: '回合开始',
      source: '角色',
    },
    handler(ctx, state) {
      if (state.players[ctx.self].vars['若愚/awakened']) return [];
      const myHealth = state.players[ctx.self].health;
      const allHealths = state.playerOrder
        .filter(n => state.players[n].info.alive)
        .map(n => state.players[n].health);
      const minHealth = Math.min(...allHealths);
      if (myHealth > minHealth) return [];
      return [
        { type: 'atoms', ops: [{ type: '设置变量', player: ctx.self, key: '若愚/awakened', value: true }] },
      ];
    },
  },
];
