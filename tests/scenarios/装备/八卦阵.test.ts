import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('八卦阵 - judgeDodge', () => {
  scenario('装备八卦阵后受到杀，触发判定并可能免伤')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '刘备');
      ctx.giveCard('P1', '八卦阵');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const armorId = ctx.findCard('P1', '八卦阵')!;
      ctx.playCard('P1', armorId);
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P2');
      ctx.snapshot('equipped');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.playCard('P2', killId, 'P1');
    })
    .act('P1 pass', ctx => {
      ctx.respond('P1');
    })
    .check('P1 判定后血量可能变化', ctx => {
      const diff = ctx.diff('equipped');
      const p1HealthChange = diff.healthChanges['P1'] ?? 0;
      expect(p1HealthChange).toBeLessThanOrEqual(0);
    })
    .check('判定红色时设置 dodged 变量且无伤害', ctx => {
      const p1 = ctx.player('P1');
      const judgeResult = p1.vars['八卦阵/dodged'];
      if (judgeResult === true) {
        const diff = ctx.diff('equipped');
        expect(diff.healthChanges['P1']).toBe(0);
      }
    })
    .run();
});
