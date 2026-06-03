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
});
