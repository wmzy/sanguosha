import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('荀彧', () => {
  describe('节命', () => {
    scenario('受到伤害后发动节命令自己补牌')
      .setup(ctx => {
        ctx.selectCharacters('荀彧', '刘备');
        ctx.giveCard('P2', '杀');
        ctx.setCurrentPlayer('P2');
        ctx.enterPlayPhase();
        // 清空 P1 手牌便于观测补牌
        const p1 = ctx.player('P1');
        ctx.state = {
          ...ctx.state,
          zones: { ...ctx.state.zones, deck: [...ctx.state.zones.deck, ...p1.hand] },
          players: {
            ...ctx.state.players,
            P1: { ...p1, hand: [] },
          },
        };
        ctx.snapshot('initial');
      })
      .act('P2 对 P1 使用杀', ctx => {
        const killId = ctx.findCard('P2', '杀');
        ctx.playCard('P2', killId!, 'P1');
      })
      .act('P1 不出闪', ctx => {
        ctx.respond('P1');
      })
      .check('节命触发：荀彧补牌至体力上限3', ctx => {
        const diff = ctx.diff('initial');
        expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(3);
      })
      .run();
  });

  describe('驱虎', () => {
    it.skip('驱虎：拼点机制（需要引擎支持拼点基础设施）', () => {
      // 驱虎涉及拼点（双方各出一张手牌比较点数）
      // 需要引擎支持选择手牌比较的基础设施
    });
  });
});
