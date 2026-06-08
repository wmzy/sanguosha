import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('鲁肃 - 好施', () => {
  scenario('摸牌阶段额外摸2张')
    .setup(ctx => {
      ctx.selectCharacters('鲁肃', '刘备');
      ctx.setHealth('P1', 3);
      ctx.registerTriggers('P1');
      ctx.snapshot('initial');
    })
    .act('触发摸牌阶段', ctx => {
      ctx.emitEvent({ type: '阶段开始', phase: '摸牌', player: 'P1' });
    })
    .check('P1 摸了2张额外牌', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(2);
    })
    .run();
});
