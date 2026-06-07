// engine/skills/马术.ts
import type { SkillDef } from '../types';

export const def: SkillDef = {
  id: '马术',
  name: '马术',
  description: '锁定技，你计算与其他角色的距离时，始终-1。',
  trigger: {
    event: '回合开始',
    source: '角色',
  },
  handler(ctx, _state) {
    return [
      { type: 'atoms', ops: [{ type: '设置变量', player: ctx.self, key: '马术/距离修正', value: -1 }] },
    ];
  },
};
