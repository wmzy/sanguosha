import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('司马懿 - 反馈', () => {
  scenario('受到杀伤害后获得伤害来源的一张手牌')
    .setup(ctx => {
      ctx.selectCharacters('司马懿', '刘备');
      ctx.giveCard('P2', '杀');
      ctx.giveCard('P2', '桃');
      ctx.giveCard('P2', '闪');
      ctx.setCurrentPlayer('P2');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀');
      ctx.playCard('P2', killId!, 'P1');
    })
    .act('P1 不出闪', ctx => {
      ctx.respond('P1');
    })
    .check('P1 受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .check('反馈触发：P2 手牌减少（被偷一张）', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBeLessThan(0);
    })
    .check('反馈触发：P1 手牌增加（获得来源的一张牌）', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(1);
    })
    .run();
});
