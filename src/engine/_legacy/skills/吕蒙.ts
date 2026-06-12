// @ts-nocheck
// engine/skills/吕蒙.ts — 吕蒙
import type { SkillDef } from '../types';

// ==================== 吕蒙 ====================

export const skills: SkillDef[] = [
  {
    id: '克己',
    name: '克己',
    description: '锁定技，若你未于出牌阶段内使用过【杀】，则你跳过弃牌阶段。',
    trigger: {
      event: '阶段开始',
      source: '角色',
      phase: '弃牌',
    },
    handler(_ctx, _state) {
      return [
        {
          type: 'condition',
          check: { not: { hasVar: { player: _ctx.self, key: '杀/usedThisTurn' } } },
          then: [
            {
              type: 'atoms',
              ops: [
                { type: '设阶段', phase: '结束' },
              ],
            },
          ],
        },
      ];
    },
  },
];
