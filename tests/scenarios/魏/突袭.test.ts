import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('张辽 - 突袭', () => {
  scenario('摸牌阶段放弃摸牌改为获得其他角色各一张手牌')
    .setup(ctx => {
      ctx.selectCharacters('张辽', '刘备', '曹操', '孙权');
      ctx.giveCard('P2', '杀');
      ctx.giveCard('P3', '闪');
      ctx.giveCard('P4', '桃');
      ctx.setCurrentPlayer('P1');
      ctx.snapshot('initial');
    })
    .act('发射摸牌阶段事件触发突袭', ctx => {
      ctx.emitEvent({
        type: '阶段开始',
        phase: '摸牌',
        player: 'P1',
      });
    })
    .check('P1 获得其他角色的手牌', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(1);
    })
    .check('其他角色失去手牌', ctx => {
      const diff = ctx.diff('initial');
      const othersLost = ['P2', 'P3', 'P4'].some(p => (diff.handSizeChanges[p] ?? 0) < 0);
      expect(othersLost).toBe(true);
    })
    .run();
});
