import { describe, expect } from 'vitest';
import { scenario } from '../scenario-runner';

describe('曹操 - 奸雄', () => {
  scenario('受到杀伤害后获得该杀')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '刘备');
      ctx.giveCard('P2', '杀');
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
    .check('奸雄触发：P1 获得造成伤害的杀', ctx => {
      const p1 = ctx.player('P1');
      const hasKill = p1.hand.some(id => ctx.state.cardMap[id]?.name === '杀');
      expect(hasKill).toBe(true);
    })
    .run();
});
