// engine/skills/荀彧.ts — 荀彧
import type { SkillDef } from '../types';

export const skills: SkillDef[] = [
  {
    id: '驱虎',
    name: '驱虎',
    description: '出牌阶段，你可以与一名角色拼点，若你赢，该角色对其攻击范围内另一名角色造成1点伤害；若你没赢，该角色对你造成1点伤害。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      optional: true,
      manual: true,
    },
    handler(_ctx, _state) {
      return [
        {
          type: 'prompt',
          text: '驱虎：选择拼点目标',
          options: [
            { label: '不发动', value: false },
            { type: 'selectPlayer', filter: { handEmpty: _ctx.self } },
          ],
          defaultChoice: false,
        },
      ];
    },
  },

  {
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
  },
];
