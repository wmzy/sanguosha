// engine/skills/曹丕.ts — 曹丕
import type { SkillDef, SkillPhase } from '../types';

export const skills: SkillDef[] = [
  {
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
  },

  {
    id: '放逐',
    name: '放逐',
    description: '每当你受到一次伤害后，可以令除你以外的任一角色补X张牌（X为你已损失体力值），然后该角色将其武将牌翻面。',
    trigger: {
      event: '受到伤害',
      source: '角色',
      optional: true,
    },
    handler(_ctx, _state) {
      const selfPlayer = _state.players[_ctx.self];
      if (!selfPlayer) return [];
      const lostHealth = selfPlayer.maxHealth - selfPlayer.health;
      if (lostHealth <= 0) return [];

      return [
        {
          type: 'prompt',
          text: `放逐：令一名角色补${lostHealth}张牌并翻面`,
          options: [
            { label: '不发动', value: false },
            { type: 'selectPlayer' },
          ],
          defaultChoice: false,
        },
      ];
    },
  },

  {
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
  },
];
