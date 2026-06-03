import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('诸葛亮 - 空城', () => {
  scenario('诸葛亮无手牌时不能成为杀的目标')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '诸葛亮');
      ctx.giveCard('P1', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const p2 = ctx.player('P2');
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P2: { ...p2, hand: [] },
        },
      };
      ctx.snapshot('initial');
    })
    .check('P2 无手牌', ctx => {
      expect(ctx.handSize('P2')).toBe(0);
    })
    .act('P1 尝试对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      expect(() => ctx.playCard('P1', killId, 'P2')).toThrow();
    })
    .check('P2 未受伤', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .run();

  scenario('诸葛亮有手牌时可以成为杀的目标')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '诸葛亮');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .check('杀成功指定 P2（进入响应窗口）', ctx => {
      expect(ctx.state.pending?.type).toBe('responseWindow');
    })
    .run();
});
