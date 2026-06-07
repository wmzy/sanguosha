import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('刘备 - 仁德', () => {
  scenario('刘备给 2 张手牌后回复 1 体力')
    .setup(ctx => {
      ctx.selectCharacters('刘备', '曹操');
      ctx.setHealth('P1', 3);
      ctx.giveCard('P1', '杀', 2);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('发动仁德', ctx => {
      ctx.useSkill('P1', '仁德');
    })
    .check('应进入仁德技能提示', ctx => {
      expect(ctx.state.pending?.type).toBe('技能选择');
    })
    .act('选择 2 张杀给 P2', ctx => {
      const p1 = ctx.player('P1');
      const killIds = p1.hand.filter(id => ctx.state.cardMap[id]?.name === '杀');
      ctx.engineAction({
        type: '技能选择',
        player: 'P1',
        choice: { cardIds: killIds.slice(0, 2), target: 'P2' },
      });
    })
    .check('刘备手牌减少 2', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBe(-2);
    })
    .check('P2 手牌增加 2', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBe(2);
    })
    .check('给出 >= 2 张，刘备回复 1 体力', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(1);
    })
    .run();

  scenario('刘备给 1 张手牌后不回血')
    .setup(ctx => {
      ctx.selectCharacters('刘备', '曹操');
      ctx.setHealth('P1', 3);
      ctx.giveCard('P1', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('发动仁德', ctx => {
      ctx.useSkill('P1', '仁德');
    })
    .act('选择 1 张杀给 P2', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.engineAction({
        type: '技能选择',
        player: 'P1',
        choice: { cardIds: [killId], target: 'P2' },
      });
    })
    .check('刘备手牌减少 1', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBe(-1);
    })
    .check('P2 手牌增加 1', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBe(1);
    })
    .check('给出不足 2 张，不回血', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(0);
    })
    .run();
});
