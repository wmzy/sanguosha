import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('赵云 - 龙胆', () => {
  scenario('赵云用杀当闪响应杀')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '赵云');
      ctx.giveCard('P1', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.giveCard('P2', '杀');
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 用杀当闪（龙胆）响应', ctx => {
      const killAsDodge = ctx.findCard('P2', '杀')!;
      ctx.respond('P2', killAsDodge);
    })
    .check('P2 未受伤（闪避成功）', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .check('P2 手牌减少 1', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBe(-1);
    })
    .run();

  scenario('赵云用闪当杀响应决斗')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '赵云');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.ensureNoKill('P2');
      ctx.giveCard('P1', '决斗');
      ctx.giveCard('P2', '闪');
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用决斗', ctx => {
      const cardId = ctx.findCard('P1', '决斗')!;
      ctx.playCard('P1', cardId, 'P2');
    })
    .act('P2 不出无懈可击', ctx => {
      ctx.respond('P2');
    })
    .act('P2 用闪当杀（龙胆）响应决斗', ctx => {
      const dodgeAsKill = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeAsKill);
    })
    .act('P1 没有杀，受决斗伤害', ctx => {
      ctx.respond('P1');
    })
    .check('P1 受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .run();
});
