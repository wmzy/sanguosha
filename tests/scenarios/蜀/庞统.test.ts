import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('庞统', () => {
  describe('连环', () => {
    scenario('连环技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('庞统', '刘备');
      })
      .check('庞统有连环技能', ctx => {
        // 阶段 D：[P5-T2] v3 真相源是 PlayerState.skills，
        // 不再读 state.triggers（v2 字段即将删除）。
        expect(ctx.player('P1').skills).toContain('连环');
      })
      .run();
  });

  describe('涅槃', () => {
    scenario('濒死时触发涅槃，摸牌并回复体力')
      .setup(ctx => {
        ctx.selectCharacters('庞统', '刘备');
        ctx.setHealth('P1', 0);
        ctx.snapshot('initial');
      })
      .act('触发dying事件', ctx => {
        ctx.emitEvent({ type: '濒死', player: 'P1' });
      })
      .check('庞统摸了3张牌', ctx => {
        expect(ctx.handSize('P1')).toBe(3);
      })
      .run();

    scenario('涅槃已使用后不再触发')
      .setup(ctx => {
        ctx.selectCharacters('庞统', '刘备');
        ctx.setHealth('P1', 0);
        ctx.emitEvent({ type: '濒死', player: 'P1' });
        ctx.setHealth('P1', 0);
        ctx.snapshot('afterFirst');
      })
      .act('再次触发dying事件', ctx => {
        ctx.emitEvent({ type: '濒死', player: 'P1' });
      })
      .check('涅槃已使用，不再摸牌', ctx => {
        expect(ctx.player('P1').vars['涅槃/used']).toBe(true);
      })
      .run();
  });
});
