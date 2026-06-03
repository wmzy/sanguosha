import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('张郃 - 巧变', () => {
  it.skip('巧变：弃手牌跳阶段（需要引擎支持多阶段跳过和场牌移动）', () => {
    // 巧变涉及：每个阶段可选择弃手牌跳过
    // 跳摸牌阶段时偷牌、跳出牌阶段时移场牌
    // 需要引擎支持场牌移动和多阶段触发的基础设施
  });

  scenario('巧变技能注册检查')
    .setup(ctx => {
      ctx.selectCharacters('张郃', '刘备');
      ctx.registerTriggers('P1');
    })
    .check('P1 拥有巧变触发器', ctx => {
      const hasTrigger = ctx.state.triggers.some(
        t => t.player === 'P1' && t.skillId === '巧变',
      );
      expect(hasTrigger).toBe(true);
    })
    .run();
});
