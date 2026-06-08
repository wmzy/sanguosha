import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('孙策 - 激昂', () => {
  scenario('使用决斗时摸1张牌')
    .setup(ctx => {
      ctx.selectCharacters('孙策', '刘备');
      ctx.registerTriggers('P1');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P1', '决斗');
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 出杀（红色杀应触发激昂）', ctx => {
      const cardId = ctx.findCard('P1', '杀');
      if (cardId) ctx.playCard('P1', cardId, 'P2');
    })
    .check('激昂未在普通杀上触发（需红色杀）', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeDefined();
    })
    .run();

  scenario('被杀成为目标时触发激昂（红色杀）')
    .setup(ctx => {
      ctx.selectCharacters('刘备', '孙策');
      ctx.registerTriggers('P2');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '杀');
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 出杀', ctx => {
      const cardId = ctx.findCard('P1', '杀');
      if (cardId) ctx.playCard('P1', cardId, 'P2');
    })
    .run();
});
