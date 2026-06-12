// @ts-nocheck
// engine/skills/许褚.ts — 许褚
import type { SkillDef } from '../types';

export const def: SkillDef = {
    id: '裸衣',
    name: '裸衣',
    description: '摸牌阶段，你可以少摸一张牌，若如此做，你使用【杀】或【决斗】时，此牌造成的伤害+1。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '摸牌',
      optional: true,
};
export const def: SkillDef = {
          type: 'prompt',
          text: '裸衣：是否少摸一张牌，使本回合【杀】/【决斗】伤害+1？',
          options: [
            { label: '不发动', value: false },
            { label: '发动', value: true },
          ],
          defaultChoice: false,
};
export const def: SkillDef = {
          type: 'condition',
          check: { equals: [{ $: 'ctx', path: 'choice' }, true] },
          then: [
            {
              type: 'atoms',
              ops: [
                { type: '设置变量', player: _ctx.self, key: '裸衣/active', value: true },
                { type: '设置变量', player: _ctx.self, key: '裸衣/usedThisTurn', value: true },
              ],
};
    },
  },
];
