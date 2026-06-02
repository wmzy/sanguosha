import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('陆逊 - 连营', () => {
  scenario('失去最后手牌后摸一张牌（emitEvent）')
    .setup(ctx => {
      ctx.selectCharacters('陆逊', '刘备');
      ctx.enterPlayPhase();
      // 让 P1 只剩 1 张手牌
      const hand = ctx.player('P1').hand;
      ctx.state = {
        ...ctx.state,
        zones: { ...ctx.state.zones, deck: [...ctx.state.zones.deck, ...hand.slice(1)] },
        players: {
          ...ctx.state.players,
          P1: { ...ctx.player('P1'), hand: [hand[0]] },
        },
      };
      ctx.snapshot('initial');
    })
    .act('弃掉最后一张手牌（直接操作状态模拟弃牌）', ctx => {
      const cardId = ctx.player('P1').hand[0];
      ctx.state = {
        ...ctx.state,
        zones: { ...ctx.state.zones, discardPile: [...ctx.state.zones.discardPile, cardId] },
        players: {
          ...ctx.state.players,
          P1: { ...ctx.player('P1'), hand: [] },
        },
      };
    })
    .act('发射 cardDiscarded 事件触发连营', ctx => {
      ctx.emitEvent({ type: 'cardDiscarded', player: 'P1', cardIds: [] });
    })
    .check('连营触发：手牌 +1（原 0 → 连营摸 1）', ctx => {
      expect(ctx.handSize('P1')).toBe(1);
    })
    .run();
});
