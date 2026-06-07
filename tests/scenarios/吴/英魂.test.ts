import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('孙坚 - 英魂', () => {
  scenario('英魂：受伤时令目标摸X弃1')
    .setup(ctx => {
      ctx.selectCharacters('孙坚', '刘备', '曹操');
      ctx.setHealth('P1', 2);
      ctx.registerTriggers('P1');
      ctx.snapshot('initial');
    })
    .act('触发准备阶段事件', ctx => {
      ctx.emitEvent({ type: '阶段开始', phase: '准备', player: 'P1' });
    })
    .check('英魂触发了技能提示（pending）', ctx => {
      expect(ctx.isPending()).toBe(true);
      expect(ctx.pendingType()).toBe('技能选择');
    })
    .run();
});
