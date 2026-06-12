// @ts-nocheck
// engine/skills/洛神.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '洛神',
  name: '洛神',
  description: '准备阶段，你可以进行判定：若结果为黑色，你获得此牌，且可以重复此流程。',
  trigger: {
    event: '阶段开始',
    source: '角色',
    phase: '准备',
  },
  handler(_ctx, _state) {
    return [
      // 预置初始判定结果为黑色，确保首次进入循环
      { type: 'atoms', ops: [{ type: '设置变量', player: _ctx.self, key: '洛神/judgeResult', value: 'black' }] },
      {
        type: 'loop',
        // 检查上次判定结果：红色则退出循环，黑色继续
        while: { notEquals: [{ $: 'var', player: { $: 'ctx', path: 'self' }, key: '洛神/judgeResult' }, 'red'] },
        body: [
          { type: 'atoms', ops: [{ type: '判定', player: _ctx.self, varKey: '洛神/judgeResult' }] },
          {
            type: 'condition',
            check: { equals: [{ $: 'var', player: { $: 'ctx', path: 'self' }, key: '洛神/judgeResult' }, 'black'] },
            then: [
              {
                type: 'atoms',
                ops: [{
                  type: '获得',
                  player: { $: 'ctx', path: 'self' },
                  cardId: { $: 'ctx', path: 'localVars.judgeCardId' },
                  from: { zone: '弃牌堆' },
                }],
              },
            ],
          },
        ],
      },
    ];
  },
};
