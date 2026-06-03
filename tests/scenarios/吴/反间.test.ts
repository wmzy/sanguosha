import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('周瑜 - 反间', () => {
  scenario('反间：目标选花色与展示牌不同时受伤')
    .setup(ctx => {
      ctx.selectCharacters('周瑜', '刘备');
      ctx.enterPlayPhase();
      const hand = ctx.player('P1').hand;
      ctx.state = {
        ...ctx.state,
        zones: { ...ctx.state.zones, deck: [...ctx.state.zones.deck, ...hand] },
        players: { ...ctx.state.players, P1: { ...ctx.player('P1'), hand: [] } },
      };
      ctx.giveCard('P1', '杀');
      ctx.snapshot('initial');
    })
    .act('发动反间', ctx => {
      ctx.useSkill('P1', '反间');
      expect(ctx.pendingType()).toBe('skillPrompt');
    })
    .act('选择目标 P2', ctx => {
      ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: { player: 'P2' } });
      expect(ctx.pendingType()).toBe('skillPrompt');
    })
    .act('选择花色 ♥（P1手牌为♠，不同）', ctx => {
      ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: '♥' });
    })
    .check('P2 受到1点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .run();

  scenario('反间：目标选花色与展示牌相同时不受伤')
    .setup(ctx => {
      ctx.selectCharacters('周瑜', '刘备');
      ctx.enterPlayPhase();
      const hand = ctx.player('P1').hand;
      ctx.state = {
        ...ctx.state,
        zones: { ...ctx.state.zones, deck: [...ctx.state.zones.deck, ...hand] },
        players: { ...ctx.state.players, P1: { ...ctx.player('P1'), hand: [] } },
      };
      ctx.giveCard('P1', '杀');
      ctx.snapshot('initial');
    })
    .act('发动反间', ctx => {
      ctx.useSkill('P1', '反间');
    })
    .act('选择目标 P2', ctx => {
      ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: { player: 'P2' } });
    })
    .act('选择花色 ♠（与手牌相同）', ctx => {
      ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: '♠' });
    })
    .check('P2 不受伤', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .run();
});
