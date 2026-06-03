import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('袁绍 - 乱击', () => {
  scenario('将两张同花色手牌当万箭齐发使用')
    .setup(ctx => {
      ctx.selectCharacters('袁绍', '曹操', '刘备');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 发动乱击（两张同花色手牌当万箭齐发）', ctx => {
      ctx.useSkill('P1', '乱击');
    })
    .check('乱击触发后进入技能选择', ctx => {
      expect(ctx.state.pending).not.toBeNull();
    })
    .run();
});
