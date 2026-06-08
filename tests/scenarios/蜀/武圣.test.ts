import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';
import type { ScenarioContext } from '../../scenario-runner';

function setCardSuit(ctx: ScenarioContext, player: string, cardName: string, suit: '♥' | '♦' | '♠' | '♣') {
  const cardId = ctx.findCard(player, cardName);
  if (!cardId) throw new Error(`${player} 没有 ${cardName}`);
  ctx.state = {
    ...ctx.state,
    cardMap: {
      ...ctx.state.cardMap,
      [cardId]: { ...ctx.state.cardMap[cardId], suit },
    },
  };
}

describe.skip('关羽 - 武圣', () => {
  scenario('关羽用红色闪当杀响应决斗')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '关羽');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.ensureNoKill('P2');
      ctx.giveCard('P1', '决斗');
      ctx.giveCard('P2', '闪');
      setCardSuit(ctx, 'P2', '闪', '♥');
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用决斗', ctx => {
      const cardId = ctx.findCard('P1', '决斗')!;
      ctx.playCard('P1', cardId, 'P2');
    })
    .act('P2 不出无懈可击', ctx => {
      ctx.respond('P2');
    })
    .act('P2 用红色闪当杀（武圣）响应决斗', ctx => {
      const redDodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', redDodgeId);
    })
    .act('P1 没有杀，受决斗伤害', ctx => {
      ctx.respond('P1');
    })
    .check('P1 受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .run();

  scenario('关羽用黑色闪不能当杀响应决斗')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '关羽');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.ensureNoKill('P2');
      ctx.giveCard('P1', '决斗');
      ctx.giveCard('P2', '闪');
      setCardSuit(ctx, 'P2', '闪', '♠');
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用决斗', ctx => {
      const cardId = ctx.findCard('P1', '决斗')!;
      ctx.playCard('P1', cardId, 'P2');
    })
    .act('P2 不出无懈可击', ctx => {
      ctx.respond('P2');
    })
    .act('P2 用黑色闪尝试响应（应失败）', ctx => {
      const blackDodgeId = ctx.findCard('P2', '闪')!;
      expect(ctx.state.cardMap[blackDodgeId]?.suit).toBe('♠');
      expect(() => ctx.respond('P2', blackDodgeId)).toThrow();
    })
    .run();
});
