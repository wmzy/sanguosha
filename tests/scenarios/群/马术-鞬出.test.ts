import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';
import { getDistance } from '../../../src/engine/distance';

describe.skip('庞德 - 马术', () => {
  scenario('马术锁定技使距离-1')
    .setup(ctx => {
      ctx.selectCharacters('庞德', '曹操', '刘备', '孙权');
      ctx.registerTriggers('P1');
    })
    .act('触发 turnStart 设置马术/距离修正', ctx => {
      ctx.emitEvent({ type: '回合开始', player: 'P1' });
    })
    .check('庞德的 马术/距离修正 被设为 -1', ctx => {
      expect(ctx.player('P1').vars['马术/距离修正']).toBe(-1);
    })
    .check('庞德到 P2 的距离减 1', ctx => {
      const dist = getDistance(ctx.state, 'P1', 'P2');
      expect(dist).toBeLessThanOrEqual(1);
    })
    .run();
});

describe.skip('庞德 - 鞬出', () => {
  scenario('使用杀指定目标后可弃置目标一张牌')
    .setup(ctx => {
      ctx.selectCharacters('庞德', '曹操');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.giveCard('P2', '桃');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .check('杀触发鞬出的 skillPrompt', ctx => {
      expect(ctx.state.pending).not.toBeNull();
      expect(ctx.state.pending?.type).toBe('技能选择');
    })
    .run();
});
