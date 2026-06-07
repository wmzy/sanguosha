import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('甘宁 - 奇袭', () => {
  scenario('奇袭：用黑色手牌当过河拆桥弃目标手牌')
    .setup(ctx => {
      ctx.selectCharacters('甘宁', '刘备');
      ctx.enterPlayPhase();
      const hand = ctx.player('P1').hand;
      ctx.state = {
        ...ctx.state,
        zones: { ...ctx.state.zones, deck: [...ctx.state.zones.deck, ...hand] },
        players: { ...ctx.state.players, P1: { ...ctx.player('P1'), hand: [] } },
      };
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '杀');
      ctx.snapshot('initial');
    })
    .act('发动奇袭', ctx => {
      ctx.useSkill('P1', '奇袭');
      expect(ctx.pendingType()).toBe('技能选择');
    })
    .act('选择黑色手牌和目标P2', ctx => {
      const p1 = ctx.player('P1');
      const blackCard = p1.hand[0];
      ctx.engineAction({ type: '技能选择', player: 'P1', choice: { cardIds: [blackCard], player: 'P2' } });
    })
    .check('P2 手牌减少', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBeLessThan(0);
    })
    .check('P1 消耗了黑色手牌', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeLessThan(0);
    })
    .run();
});
