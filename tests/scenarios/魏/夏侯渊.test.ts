import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('夏侯渊 - 神速', () => {
  scenario('神速：跳过判定和摸牌阶段，视为使用杀')
    .setup(ctx => {
      ctx.selectCharacters('夏侯渊', '刘备');
      ctx.registerTriggers('P1');
      ctx.registerTriggers('P2');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.giveCard('P2', '闪');
      ctx.snapshot('initial');
    })
    .act('P1 发动神速（视为使用杀，目标 P2）', ctx => {
      ctx.useSkill('P1', '神速', 'P2');
    })
    .act('P2 出闪抵消', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeId);
    })
    .check('P2 未受伤', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .run();

  scenario('神速：目标不闪则受伤')
    .setup(ctx => {
      ctx.selectCharacters('夏侯渊', '刘备');
      ctx.registerTriggers('P1');
      ctx.registerTriggers('P2');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 发动神速（视为使用杀，目标 P2）', ctx => {
      ctx.useSkill('P1', '神速', 'P2');
    })
    .act('P2 不出闪', ctx => {
      ctx.respond('P2');
    })
    .check('P2 受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .run();

  scenario('神速技能注册检查')
    .setup(ctx => {
      ctx.selectCharacters('夏侯渊', '刘备');
      ctx.registerTriggers('P1');
    })
    .check('P1 拥有神速触发器', ctx => {
      const hasTrigger = ctx.state.triggers.some(
        t => t.player === 'P1' && t.skillId === '神速',
      );
      expect(hasTrigger).toBe(true);
    })
    .run();

  scenario('神速：视为使用杀不消耗手牌中的杀')
    .setup(ctx => {
      ctx.selectCharacters('夏侯渊', '刘备');
      ctx.registerTriggers('P1');
      ctx.registerTriggers('P2');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.snapshot('initial');
    })
    .act('P1 发动神速（视为使用杀，目标 P2）', ctx => {
      ctx.useSkill('P1', '神速', 'P2');
    })
    .act('P2 出闪抵消', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeId);
    })
    .check('P1 的杀仍在手牌中', ctx => {
      const killId = ctx.findCard('P1', '杀');
      expect(killId).toBeDefined();
    })
    .run();
});
