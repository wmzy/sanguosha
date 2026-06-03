import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('刘备 - 激将', () => {
  scenario('令蜀势力角色替你出杀')
    .setup(ctx => {
      ctx.selectCharacters('刘备', '关羽');
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('发动激将，令 P2 替你出杀', ctx => {
      ctx.useSkill('P1', '激将');
    })
    .check('P2 应被提示出杀', ctx => {
      expect(ctx.state.pending).not.toBeNull();
    })
    .run();
});
