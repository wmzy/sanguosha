import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('司马懿 - 鬼才', () => {
  scenario('判定牌生效前用手牌替换判定牌')
    .setup(ctx => {
      ctx.selectCharacters('司马懿', '刘备');
      ctx.giveCard('P1', '桃');
      ctx.snapshot('initial');
    })
    .act('发射 judgeResult 事件触发鬼才', ctx => {
      ctx.emitEvent({
        type: 'judgeResult',
        player: 'P1',
        cardId: 'fake-judge-card',
        result: 'red',
      });
    })
    .check('鬼才触发后创建技能选择提示', ctx => {
      expect(ctx.state.pending).not.toBeNull();
      expect(ctx.state.pending?.type).toBe('skillPrompt');
    })
    .run();

  scenario('选择不替换时手牌不变')
    .setup(ctx => {
      ctx.selectCharacters('司马懿', '刘备');
      ctx.giveCard('P1', '桃');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('发射 judgeResult 事件触发鬼才', ctx => {
      ctx.emitEvent({
        type: 'judgeResult',
        player: 'P1',
        cardId: 'fake-judge-card',
        result: 'red',
      });
    })
    .act('记录回答前手牌数', ctx => {
      ctx.snapshot('before-choice');
    })
    .act('选择不替换', ctx => {
      ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: false });
    })
    .check('手牌不变', ctx => {
      const diff = ctx.diff('before-choice');
      expect(diff.handSizeChanges['P1']).toBe(0);
    })
    .run();

  scenario('选择手牌替换判定牌')
    .setup(ctx => {
      ctx.selectCharacters('司马懿', '刘备');
      ctx.giveCard('P1', '桃');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('发射 judgeResult 事件触发鬼才', ctx => {
      ctx.emitEvent({
        type: 'judgeResult',
        player: 'P1',
        cardId: 'fake-judge-card',
        result: 'red',
      });
    })
    .act('选择手牌替换判定牌', ctx => {
      const cardId = ctx.findCard('P1', '桃')!;
      ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: cardId });
    })
    .check('选中的牌从手牌移出', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeLessThan(0);
    })
    .run();
});
