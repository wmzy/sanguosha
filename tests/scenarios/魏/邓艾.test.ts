import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('邓艾', () => {
  describe('屯田', () => {
    scenario('回合外失去牌时判定攒田')
      .setup(ctx => {
        ctx.selectCharacters('邓艾', '刘备');
        ctx.giveCard('P1', '杀');
        ctx.state = { ...ctx.state, currentPlayer: 'P2' };
      })
      .act('P1 在 P2 的回合中弃牌', ctx => {
        const killId = ctx.findCard('P1', '杀')!;
        ctx.emitEvent({ type: 'cardDiscarded', player: 'P1', cardIds: [killId] });
      })
      .check('屯田判定执行完成', ctx => {
        const judgeResult = ctx.player('P1').vars['屯田/judgeResult'];
        expect(typeof judgeResult === 'string').toBe(true);
      })
      .run();

    scenario('回合内失去牌时不触发屯田')
      .setup(ctx => {
        ctx.selectCharacters('邓艾', '刘备');
        ctx.giveCard('P1', '杀');
        ctx.state = { ...ctx.state, currentPlayer: 'P1' };
      })
      .act('P1 在自己的回合中弃牌', ctx => {
        const killId = ctx.findCard('P1', '杀')!;
        ctx.emitEvent({ type: 'cardDiscarded', player: 'P1', cardIds: [killId] });
      })
      .check('屯田不触发（回合内）', ctx => {
        const count = ctx.player('P1').vars['屯田/count'];
        expect(count).toBeUndefined();
      })
      .run();

    scenario('屯田技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('邓艾', '刘备');
        ctx.registerTriggers('P1');
      })
      .check('P1 拥有屯田触发器', ctx => {
        const hasTrigger = ctx.state.triggers.some(
          t => t.player === 'P1' && t.skillId === '屯田',
        );
        expect(hasTrigger).toBe(true);
      })
      .run();
  });

  describe('凿险', () => {
    scenario('田数>=3时觉醒减体力上限')
      .setup(ctx => {
        ctx.selectCharacters('邓艾', '刘备');
        const p = ctx.player('P1');
        ctx.state = {
          ...ctx.state,
          players: {
            ...ctx.state.players,
            P1: { ...p, vars: { ...p.vars, '屯田/count': 3 } },
          },
        };
      })
      .act('触发准备阶段', ctx => {
        ctx.emitEvent({ type: 'phaseBegin', phase: '准备', player: 'P1' });
      })
      .check('凿险已觉醒标记', ctx => {
        expect(ctx.player('P1').vars['凿险/awakened']).toBe(true);
      })
      .check('体力上限减少1', ctx => {
        expect(ctx.player('P1').maxHealth).toBe(3);
      })
      .run();

    scenario('田数<3时不觉醒')
      .setup(ctx => {
        ctx.selectCharacters('邓艾', '刘备');
        const p = ctx.player('P1');
        ctx.state = {
          ...ctx.state,
          players: {
            ...ctx.state.players,
            P1: { ...p, vars: { ...p.vars, '屯田/count': 2 } },
          },
        };
      })
      .act('触发准备阶段', ctx => {
        ctx.emitEvent({ type: 'phaseBegin', phase: '准备', player: 'P1' });
      })
      .check('凿险不触发（田数不足）', ctx => {
        expect(ctx.player('P1').vars['凿险/awakened']).toBeUndefined();
      })
      .check('体力上限不变', ctx => {
        expect(ctx.player('P1').maxHealth).toBe(4);
      })
      .run();

    scenario('已觉醒后不再触发')
      .setup(ctx => {
        ctx.selectCharacters('邓艾', '刘备');
        const p = ctx.player('P1');
        ctx.state = {
          ...ctx.state,
          players: {
            ...ctx.state.players,
            P1: { ...p, vars: { ...p.vars, '屯田/count': 5, '凿险/awakened': true } },
          },
        };
      })
      .act('再次触发准备阶段', ctx => {
        ctx.emitEvent({ type: 'phaseBegin', phase: '准备', player: 'P1' });
      })
      .check('体力上限不再减少', ctx => {
        expect(ctx.player('P1').maxHealth).toBe(4);
      })
      .run();

    scenario('凿险技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('邓艾', '刘备');
        ctx.registerTriggers('P1');
      })
      .check('P1 拥有凿险触发器', ctx => {
        const hasTrigger = ctx.state.triggers.some(
          t => t.player === 'P1' && t.skillId === '凿险',
        );
        expect(hasTrigger).toBe(true);
      })
      .run();
  });
});
