// engine/skills/孙坚.ts — 孙坚
import type { SkillDef } from '../types';
import { getPlayer } from '../state';

// ==================== 孙坚 ====================

export const skills: SkillDef[] = [
  {
    id: '英魂',
    name: '英魂',
    description: '回合开始阶段，若你已受伤，可令一名其他角色选择一项：1.摸X张牌再弃一张牌；2.摸一张牌再弃X张牌（X为你已损失体力值）。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '准备',
      optional: true,
    },
    handler(_ctx, _state) {
      const player = getPlayer(_state, _ctx.self);
      const x = player.maxHealth - player.health;
      if (x <= 0) return [];

      return [
        {
          type: 'prompt',
          text: `英魂：选择一名其他角色执行英魂效果（X=${x}）`,
          options: [
            { type: 'selectPlayer' },
          ],
        },
        {
          type: 'atoms',
          ops: [
            { type: '设置上下文变量', key: 'target', value: { $: 'ctx', path: 'choice.player' } as const },
          ],
        },
        {
          type: 'prompt',
          text: `英魂：请选择执行项（X=${x}）`,
          options: [
            { label: `摸${x}张牌，弃1张牌`, value: 'option1' },
            { label: `摸1张牌，弃${x}张牌`, value: 'option2' },
          ],
        },
        {
          type: 'condition',
          check: { equals: [{ $: 'ctx', path: 'choice' }, 'option1'] },
          then: [
            { type: 'atoms', ops: [{ type: '摸牌', player: { $: 'ctx', path: 'localVars.target' } as const, count: x }] },
            {
              type: 'prompt',
              text: '英魂：请弃置1张牌',
              options: [
                { type: 'selectCards', from: '手牌', min: 1, max: 1 },
              ],
            },
            {
              type: 'atoms',
              ops: [{ type: '弃置', player: { $: 'ctx', path: 'localVars.target' } as const, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const }],
            },
          ],
          else: [
            { type: 'atoms', ops: [{ type: '摸牌', player: { $: 'ctx', path: 'localVars.target' } as const, count: 1 }] },
            {
              type: 'prompt',
              text: `英魂：请弃置${x}张牌`,
              options: [
                { type: 'selectCards', from: '手牌', min: x, max: x },
              ],
            },
            {
              type: 'atoms',
              ops: [{ type: '弃置', player: { $: 'ctx', path: 'localVars.target' } as const, cardIds: { $: 'ctx', path: 'choice.cardIds' } as const }],
            },
          ],
        },
      ];
    },
  },
];
