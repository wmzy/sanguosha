import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('大乔 - 国色', () => {
  scenario('国色：用♦牌当乐不思蜀放入目标判定区')
    .setup(ctx => {
      ctx.selectCharacters('大乔', '刘备');
      ctx.enterPlayPhase();
      const hand = ctx.player('P1').hand;
      ctx.state = {
        ...ctx.state,
        zones: { ...ctx.state.zones, deck: [...ctx.state.zones.deck, ...hand] },
        players: { ...ctx.state.players, P1: { ...ctx.player('P1'), hand: [] } },
      };
      ctx.giveCard('P1', '杀');
      const cardId = ctx.player('P1').hand[0];
      ctx.state = {
        ...ctx.state,
        cardMap: { ...ctx.state.cardMap, [cardId]: { ...ctx.state.cardMap[cardId], suit: '♦' } },
      };
      ctx.snapshot('initial');
    })
    .act('发动国色', ctx => {
      ctx.useSkill('P1', '国色');
      expect(ctx.pendingType()).toBe('技能选择');
    })
    .act('选择♦手牌和目标P2', ctx => {
      const p1 = ctx.player('P1');
      const card = p1.hand[0];
      ctx.engineAction({ type: '技能选择', player: 'P1', choice: { cardIds: [card], player: 'P2' } });
    })
    .check('P2 判定区有乐不思蜀', ctx => {
      const p2 = ctx.player('P2');
      expect(p2.pendingTricks.length).toBe(1);
      expect(p2.pendingTricks[0].name).toBe('乐不思蜀');
    })
    .check('P1 消耗了♦手牌', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBe(-1);
    })
    .run();
});
