import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('姜维', () => {
  describe('挑衅', () => {
    scenario('挑衅技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('姜维', '刘备');
      })
      .check('姜维有挑衅技能触发器', ctx => {
        const triggers = ctx.state.triggers.filter(
          t => t.player === 'P1' && t.skillId === '挑衅',
        );
        expect(triggers.length).toBeGreaterThan(0);
      })
      .run();
  });

  describe('志继', () => {
    scenario('无手牌时觉醒，选择回复体力')
      .setup(ctx => {
        ctx.selectCharacters('姜维', '刘备');
        ctx.setHealth('P1', 2);
        const p = ctx.player('P1');
        ctx.state = {
          ...ctx.state,
          players: {
            ...ctx.state.players,
            P1: { ...p, hand: [] },
          },
        };
        ctx.snapshot('initial');
      })
      .act('触发turnStart', ctx => {
        ctx.emitEvent({ type: 'turnStart', player: 'P1' });
      })
      .check('志继已觉醒标记', ctx => {
        expect(ctx.player('P1').vars['志继/awakened']).toBe(true);
      })
      .run();

    scenario('有手牌时志继不触发')
      .setup(ctx => {
        ctx.selectCharacters('姜维', '刘备');
        ctx.setHealth('P1', 2);
        ctx.giveCard('P1', '杀');
      })
      .act('触发turnStart', ctx => {
        ctx.emitEvent({ type: 'turnStart', player: 'P1' });
      })
      .check('志继不触发（有手牌）', ctx => {
        expect(ctx.player('P1').vars['志继/awakened']).toBeUndefined();
      })
      .run();

    scenario('已觉醒后不再触发')
      .setup(ctx => {
        ctx.selectCharacters('姜维', '刘备');
        ctx.setHealth('P1', 2);
        const p = ctx.player('P1');
        ctx.state = {
          ...ctx.state,
          players: {
            ...ctx.state.players,
            P1: { ...p, hand: [], vars: { '志继/awakened': true } },
          },
        };
      })
      .act('触发turnStart', ctx => {
        ctx.emitEvent({ type: 'turnStart', player: 'P1' });
      })
      .check('志继不再重复触发', ctx => {
        expect(ctx.player('P1').vars['志继/awakened']).toBe(true);
      })
      .run();
  });
});
