import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('孙尚香 - 枭姬', () => {
  scenario('失去装备区牌后摸一张牌（emitEvent）')
    .setup(ctx => {
      ctx.selectCharacters('孙尚香', '刘备');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('发射 equipChanged 事件触发枭姬', ctx => {
      ctx.emitEvent({
        type: '装备变动',
        player: 'P1',
        slot: '武器',
      });
    })
    .check('枭姬触发：手牌 +1', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBe(1);
    })
    .run();
});
