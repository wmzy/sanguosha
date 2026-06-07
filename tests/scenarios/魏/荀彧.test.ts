import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('荀彧', () => {
  describe('节命', () => {
    scenario('受到伤害后发动节命令自己补牌')
      .setup(ctx => {
        ctx.selectCharacters('荀彧', '刘备');
        ctx.registerTriggers('P1');
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
      .act('发射 damageReceived 事件', ctx => {
        ctx.emitEvent({
          type: '受到伤害',
          target: 'P1',
          source: 'P2',
          amount: 1,
        });
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
