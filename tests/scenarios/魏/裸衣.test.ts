import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('许褚 - 裸衣', () => {
  scenario('发动裸衣后杀伤害+1')
    .setup(ctx => {
      ctx.selectCharacters('许褚', '刘备');
      ctx.giveCard('P1', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.snapshot('initial');
    })
    .act('发射摸牌阶段事件触发裸衣prompt', ctx => {
      ctx.emitEvent({
        type: '阶段开始',
        phase: '摸牌',
        player: 'P1',
      });
    })
    .act('P1选择发动裸衣', ctx => {
      ctx.engineAction({ type: '技能选择', player: 'P1', choice: true });
    })
    .act('P1对P2使用杀', ctx => {
      ctx.enterPlayPhase();
      ctx.setCurrentPlayer('P1');
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2不出闪', ctx => {
      ctx.respond('P2');
    })
    .check('裸衣激活时杀造成2点伤害', ctx => {
      const p2 = ctx.player('P2');
      expect(p2.health).toBeLessThanOrEqual(ctx.player('P2').maxHealth - 2);
    })
    .run();
});
