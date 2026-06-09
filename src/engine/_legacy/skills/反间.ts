// engine/skills/反间.ts — 反间
import type { SkillDef } from '../types';
import { getPlayer } from '../state';

export const def: SkillDef = 
  {
    id: '反间',
    name: '反间',
    description: '出牌阶段，你可以令一名其他角色选择一种花色，然后展示你的一张手牌：若此牌花色与其所选不同，其受到1点伤害。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '出牌',
      manual: true,
      optional: true,
    },
    handler(_ctx, _state) {
      const player = getPlayer(_state, _ctx.self);
      const firstCard = player.hand.length > 0 ? _state.cardMap[player.hand[0]] : null;
      if (!firstCard) return [];

      return [
        {
          type: 'prompt',
          text: '反间：选择目标角色',
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
          text: '反间：请选择一种花色',
          options: [
            { label: '♠', value: '♠' },
            { label: '♥', value: '♥' },
            { label: '♣', value: '♣' },
            { label: '♦', value: '♦' },
          ],
        },
        {
          type: 'condition',
          check: { notEquals: [{ $: 'ctx', path: 'choice' } as const, firstCard.suit] },
          then: [
            {
              type: 'atoms',
              ops: [
                { type: '造成伤害', target: { $: 'ctx', path: 'localVars.target' } as const, amount: 1 },
              ],
            },
          ],
        },
      ];
    },
  },
