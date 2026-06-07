import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('典韦 - 强袭', () => {
  scenario('强袭：自减体力对目标造成伤害')
    .setup(ctx => {
      ctx.selectCharacters('典韦', '刘备');
      ctx.registerTriggers('P1');
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('使用强袭技能', ctx => {
      ctx.useSkill('P1', '强袭', 'P2');
    })
    .check('典韦自减1点体力', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBeLessThanOrEqual(-1);
    })
    .check('目标受到1点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBeLessThanOrEqual(-1);
    })
    .run();

  scenario('强袭技能注册检查')
    .setup(ctx => {
      ctx.selectCharacters('典韦', '刘备');
      ctx.registerTriggers('P1');
    })
    .check('P1 拥有强袭触发器', ctx => {
      const hasTrigger = ctx.player('P1').skills.includes('强袭');
      expect(hasTrigger).toBe(true);
    })
    .run();
});
