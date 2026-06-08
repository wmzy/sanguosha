import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('曹仁 - 据守', () => {
  scenario('结束阶段发动据守摸三张牌')
    .setup(ctx => {
      ctx.selectCharacters('曹仁', '刘备');
      ctx.registerTriggers('P1');
      ctx.snapshot('initial');
    })
    .act('发射结束阶段事件', ctx => {
      ctx.emitEvent({
        type: '阶段开始',
        phase: '结束',
        player: 'P1',
      });
    })
    .check('曹仁摸了3张牌', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(3);
    })
    .check('曹仁被标记为翻面状态', ctx => {
      const p1 = ctx.player('P1');
      expect(p1.vars['据守/flipped']).toBe(true);
    })
    .run();
});
