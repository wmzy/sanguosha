import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('决斗 + 奸雄', () => {
  scenario('曹操受决斗伤害后奸雄获得决斗')
    .setup(ctx => {
      ctx.selectCharacters('甄姬', '曹操');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.ensureNoKill('P2');
      ctx.giveCard('P1', '决斗');
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用决斗', ctx => {
      const cardId = ctx.findCard('P1', '决斗')!;
      ctx.playCard('P1', cardId, 'P2');
    })
    .act('P2 不出无懈可击', ctx => {
      ctx.respond('P2');
    })
    .check('应进入决斗响应阶段', ctx => {
      expect(ctx.state.pending?.type).toBe('responseWindow');
      if (ctx.state.pending?.type === 'responseWindow') {
        expect(ctx.state.pending.window.type).toBe('duelResponse');
        expect(ctx.state.pending.window.defender).toBe('P2');
      }
    })
    .act('P2 没有杀，不出杀受伤害', ctx => {
      ctx.respond('P2');
    })
    .check('曹操应受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .check('奸雄触发：曹操获得决斗', ctx => {
      const p2 = ctx.player('P2');
      const hasDuel = p2.hand.some(id => ctx.state.cardMap[id]?.name === '决斗');
      expect(hasDuel).toBe(true);
    })
    .run();
});
