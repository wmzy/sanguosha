import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('郭嘉 - 遗计', () => {
  scenario('受到伤害后摸两张牌')
    .setup(ctx => {
      ctx.selectCharacters('郭嘉', '刘备');
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P2');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.playCard('P2', killId, 'P1');
    })
    .act('P1 不出闪', ctx => {
      ctx.respond('P1');
    })
    .check('郭嘉受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .check('遗计触发：手牌 +2', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(2);
    })
    .run();
});
