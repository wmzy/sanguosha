import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('小乔 - 红颜', () => {
  scenario('红颜标记在回合开始时设置')
    .setup(ctx => {
      ctx.selectCharacters('小乔', '刘备');
      ctx.registerTriggers('P1');
    })
    .act('触发回合开始事件', ctx => {
      ctx.emitEvent({ type: '回合开始', player: 'P1' });
    })
    .check('P1 获得红颜标记', ctx => {
      const p = ctx.player('P1');
      expect(p.tags).toContain('spadeToHeart');
    })
    .run();
});
