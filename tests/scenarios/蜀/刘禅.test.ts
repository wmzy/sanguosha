import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('刘禅', () => {
  describe('享乐', () => {
    scenario('被杀指定时给攻击者添加享乐/discardBasic标记')
      .setup(ctx => {
        ctx.selectCharacters('刘备', '刘禅');
        ctx.giveCard('P1', '杀');
        ctx.enterPlayPhase();
      })
      .act('刘备对刘禅使用杀', ctx => {
        const killId = ctx.findCard('P1', '杀')!;
        ctx.emitEvent({
          type: '出牌',
          player: 'P1',
          cardId: killId,
          target: 'P2',
        });
      })
      .check('刘备获得享乐/discardBasic标记', ctx => {
        expect(ctx.player('P1').tags).toContain('享乐/discardBasic');
      })
      .run();

    scenario('不是杀不触发享乐')
      .setup(ctx => {
        ctx.selectCharacters('刘备', '刘禅');
        ctx.giveCard('P1', '桃');
        ctx.enterPlayPhase();
      })
      .act('刘备使用桃（不是杀）', ctx => {
        const peachId = ctx.findCard('P1', '桃')!;
        ctx.emitEvent({
          type: '出牌',
          player: 'P1',
          cardId: peachId,
          target: 'P2',
        });
      })
      .check('刘备没有享乐/discardBasic标记', ctx => {
        expect(ctx.player('P1').tags).not.toContain('享乐/discardBasic');
      })
      .run();

    scenario('不是以刘禅为目标不触发')
      .setup(ctx => {
        ctx.selectCharacters('刘备', '刘禅');
        ctx.giveCard('P1', '杀');
        ctx.enterPlayPhase();
      })
      .act('刘备对自己使用杀', ctx => {
        const killId = ctx.findCard('P1', '杀')!;
        ctx.emitEvent({
          type: '出牌',
          player: 'P1',
          cardId: killId,
          target: 'P1',
        });
      })
      .check('刘备没有享乐/discardBasic标记（不是以刘禅为目标）', ctx => {
        expect(ctx.player('P1').tags).not.toContain('享乐/discardBasic');
      })
      .run();
  });

  describe('放权', () => {
    scenario('放权技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('刘禅', '刘备');
      })
      .check('刘禅有放权技能触发器', ctx => {
        const triggers = ctx.player('P1').skills.filter(s => s === '放权');
        expect(triggers.length).toBeGreaterThan(0);
      })
      .run();
  });

  describe('若愚', () => {
    scenario('体力全场最少时觉醒')
      .setup(ctx => {
        ctx.selectCharacters('刘禅', '刘备');
        ctx.setHealth('P1', 1);
      })
      .act('触发turnStart', ctx => {
        ctx.emitEvent({ type: '回合开始', player: 'P1' });
      })
      .check('若愚已觉醒标记', ctx => {
        expect(ctx.player('P1').vars['若愚/awakened']).toBe(true);
      })
      .run();

    scenario('体力不是最少时不觉醒')
      .setup(ctx => {
        ctx.selectCharacters('刘禅', '刘备');
        ctx.setHealth('P2', 2);
      })
      .act('触发turnStart（P1体力3，P2体力2）', ctx => {
        ctx.emitEvent({ type: '回合开始', player: 'P1' });
      })
      .check('若愚不触发（体力不是最少）', ctx => {
        expect(ctx.player('P1').vars['若愚/awakened']).toBeUndefined();
      })
      .run();

    scenario('已觉醒后不再触发')
      .setup(ctx => {
        ctx.selectCharacters('刘禅', '刘备');
        ctx.setHealth('P1', 1);
        ctx.emitEvent({ type: '回合开始', player: 'P1' });
      })
      .act('再次触发turnStart', ctx => {
        ctx.emitEvent({ type: '回合开始', player: 'P1' });
      })
      .check('若愚不重复触发', ctx => {
        expect(ctx.player('P1').vars['若愚/awakened']).toBe(true);
      })
      .run();

    scenario('体力并列最少时也觉醒')
      .setup(ctx => {
        ctx.selectCharacters('刘禅', '刘备');
        ctx.setHealth('P1', 3);
        ctx.setHealth('P2', 3);
      })
      .act('触发turnStart（P1和P2体力相同）', ctx => {
        ctx.emitEvent({ type: '回合开始', player: 'P1' });
      })
      .check('若愚觉醒（体力并列最少）', ctx => {
        expect(ctx.player('P1').vars['若愚/awakened']).toBe(true);
      })
      .run();
  });
});
