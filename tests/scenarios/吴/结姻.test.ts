import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('孙尚香 - 结姻', () => {
  scenario('结姻：弃2牌令受伤男性回复1体力')
    .setup(ctx => {
      ctx.selectCharacters('孙尚香', '刘备');
      ctx.enterPlayPhase();
      const hand = ctx.player('P1').hand;
      ctx.state = {
        ...ctx.state,
        zones: { ...ctx.state.zones, deck: [...ctx.state.zones.deck, ...hand] },
        players: { ...ctx.state.players, P1: { ...ctx.player('P1'), hand: [] } },
      };
      ctx.giveCard('P1', '杀', 3);
      ctx.setHealth('P2', 2);
      ctx.snapshot('initial');
    })
    .act('发动结姻', ctx => {
      ctx.useSkill('P1', '结姻');
      expect(ctx.pendingType()).toBe('技能选择');
    })
    .act('选择2张手牌和目标P2', ctx => {
      const p1 = ctx.player('P1');
      const cardIds = p1.hand.slice(0, 2);
      ctx.engineAction({ type: '技能选择', player: 'P1', choice: { cardIds, player: 'P2' } });
    })
    .check('P2 回复1体力', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(1);
    })
    .check('P1 弃2张牌', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBe(-2);
    })
    .run();
});
