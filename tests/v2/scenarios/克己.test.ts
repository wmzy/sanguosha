import { describe, expect } from 'vitest';
import { scenario } from '../scenario-runner';

describe('吕蒙 - 克己', () => {
  scenario('未出杀时触发克己跳过弃牌阶段')
    .setup(ctx => {
      ctx.selectCharacters('吕蒙', '刘备');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('触发 phaseBegin(弃牌)', ctx => {
      // 克己监听 phaseBegin(弃牌)，引擎路径当前未发射此事件
      // 通过 emitEvent 直接触发
      ctx.emitEvent({ type: 'phaseBegin', phase: '弃牌', player: 'P1' });
    })
    .check('克己触发：阶段跳过弃牌直接设为结束', ctx => {
      // 克己 handler 检查未出杀 → setPhase('结束')
      // 当前没有 杀/usedThisTurn 变量 → condition 通过
      expect(ctx.state.phase).toBe('结束');
    })
    .run();

  scenario('出杀后克己不触发，正常弃牌')
    .setup(ctx => {
      ctx.selectCharacters('吕蒙', '刘备');
      ctx.enterPlayPhase();
      // 手动标记已出杀
      const p1 = ctx.player('P1');
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P1: { ...p1, vars: { ...p1.vars, '杀/usedThisTurn': true } },
        },
      };
      ctx.snapshot('initial');
    })
    .act('触发 phaseBegin(弃牌)', ctx => {
      ctx.emitEvent({ type: 'phaseBegin', phase: '弃牌', player: 'P1' });
    })
    .check('克己不触发：阶段不变（仍为出牌阶段，因为未 setPhase）', ctx => {
      expect(ctx.state.phase).toBe('出牌');
    })
    .run();
});
