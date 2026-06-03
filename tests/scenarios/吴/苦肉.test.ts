import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('黄盖 - 苦肉', () => {
  scenario('自伤 1 摸 2')
    .setup(ctx => {
      ctx.selectCharacters('黄盖', '刘备');
      ctx.setHealth('P1', 4);
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('发动苦肉', ctx => {
      ctx.useSkill('P1', '苦肉');
    })
    .check('体力 -1', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .check('摸 2 张牌', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(2);
    })
    .run();

  scenario('同一出牌阶段可多次发动')
    .setup(ctx => {
      ctx.selectCharacters('黄盖', '刘备');
      ctx.setHealth('P1', 4);
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('第 1 次苦肉', ctx => {
      ctx.useSkill('P1', '苦肉');
    })
    .check('体力 -1', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .act('第 2 次苦肉', ctx => {
      ctx.useSkill('P1', '苦肉');
    })
    .check('体力 -2', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-2);
    })
    .run();
});
