import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('甄姬 - 倾国', () => {
  scenario('用黑色手牌当闪响应杀')
    .setup(ctx => {
      ctx.selectCharacters('甄姬', '刘备');
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P2');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.playCard('P2', killId, 'P1');
    })
    .check('进入杀响应窗口', ctx => {
      expect(ctx.isPending()).toBe(true);
      expect(ctx.pendingType()).toBe('响应窗口');
    })
    .act('P1 查找黑色手牌当闪', ctx => {
      const p1 = ctx.player('P1');
      const blackCard = p1.hand.find(id => {
        const card = ctx.state.cardMap[id];
        return card && (card.suit === '♠' || card.suit === '♣');
      });
      ctx.respond('P1', blackCard);
    })
    .check('P1 成功闪避，体力不变', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(0);
    })
    .run();
});
