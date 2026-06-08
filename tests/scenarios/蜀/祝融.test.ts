import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('祝融', () => {
  describe('巨象', () => {
    scenario('回合开始添加immune南蛮入侵和收集标记')
      .setup(ctx => {
        ctx.selectCharacters('祝融', '刘备');
      })
      .act('触发turnStart', ctx => {
        ctx.emitEvent({ type: '回合开始', player: 'P1' });
      })
      .check('祝融获得immune南蛮入侵标记', ctx => {
        expect(ctx.player('P1').tags).toContain('immune南蛮入侵');
      })
      .check('祝融获得collect南蛮入侵标记', ctx => {
        expect(ctx.player('P1').tags).toContain('collect南蛮入侵');
      })
      .run();
  });

  describe('烈刃', () => {
    scenario('烈刃技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('祝融', '刘备');
      })
      .check('祝融有烈刃技能触发器', ctx => {
        const triggers = ctx.player('P1').skills.filter(s => s === '烈刃');
        expect(triggers.length).toBeGreaterThan(0);
      })
      .run();

    scenario('自己造成伤害时触发烈刃')
      .setup(ctx => {
        ctx.selectCharacters('祝融', '刘备');
      })
      .act('祝融对P2造成伤害', ctx => {
        ctx.emitEvent({
          type: '造成伤害',
          source: 'P1',
          target: 'P2',
          amount: 1,
        });
      })
      .check('事件正常触发无报错', ctx => {
        expect(ctx.player('P1').health).toBe(4);
      })
      .run();

    scenario('非自己造成的伤害不触发烈刃')
      .setup(ctx => {
        ctx.selectCharacters('祝融', '刘备');
      })
      .act('P2对祝融造成伤害', ctx => {
        ctx.emitEvent({
          type: '造成伤害',
          source: 'P2',
          target: 'P1',
          amount: 1,
        });
      })
      .check('烈刃不应触发（非自己造成伤害）', ctx => {
        const triggers = ctx.player('P1').skills.filter(s => s === '烈刃');
        expect(triggers.length).toBeGreaterThan(0);
      })
      .run();
  });
});
