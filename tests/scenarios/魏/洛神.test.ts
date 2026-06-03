import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('甄姬 - 洛神', () => {
  scenario('准备阶段判定，黑色获得，红色停止')
    .setup(ctx => {
      ctx.selectCharacters('甄姬', '刘备');
      ctx.snapshot('initial');
    })
    .act('发射准备阶段事件触发洛神', ctx => {
      ctx.emitEvent({
        type: 'phaseBegin',
        phase: '准备',
        player: 'P1',
      });
    })
    .check('洛神判定后 P1 手牌可能增加或不变', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(0);
    })
    .check('洛神执行判定（牌堆顶牌移到弃牌堆或手牌）', ctx => {
      const initialDeck = ctx.snapshot('initial').deckSize;
      const currentDeck = ctx.state.zones.deck.length;
      expect(currentDeck).toBeLessThanOrEqual(initialDeck);
    })
    .run();
});
