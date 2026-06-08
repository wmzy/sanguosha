import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('张昭张纮 - 直谏', () => {
  scenario('将装备牌给其他角色后摸1张')
    .setup(ctx => {
      ctx.selectCharacters('张昭张纮', '刘备');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '诸葛连弩');
      ctx.snapshot('initial');
    })
    .act('发动直谏', ctx => {
      ctx.useSkill('P1', '直谏');
    })
    .check('出现技能提示（选牌+选目标）', ctx => {
      expect(ctx.isPending()).toBe(true);
      expect(ctx.pendingType()).toBe('技能选择');
    })
    .run();
});
