import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('黄月英 - 集智', () => {
  scenario('使用非延时锦囊后摸一张牌（emitEvent）')
    .setup(ctx => {
      ctx.selectCharacters('黄月英', '刘备');
      ctx.giveCard('P1', '无中生有');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('摸一张牌（集智）', ctx => {
      const trickId = ctx.findCard('P1', '无中生有')!;
      // cardPlayed GameEvent 当前引擎路径未发射，直接 emitEvent
      ctx.emitEvent({
        type: '出牌',
        player: 'P1',
        cardId: trickId,
      });
    })
    .check('手牌 +1', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBe(1);
    })
    .run();
});
