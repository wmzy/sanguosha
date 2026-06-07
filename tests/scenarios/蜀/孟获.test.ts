import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('孟获', () => {
  describe('祸首', () => {
    scenario('回合开始添加免疫南蛮入侵标记')
      .setup(ctx => {
        ctx.selectCharacters('孟获', '刘备');
      })
      .act('触发turnStart', ctx => {
        ctx.emitEvent({ type: '回合开始', player: 'P1' });
      })
      .check('孟获获得immune南蛮入侵标记', ctx => {
        expect(ctx.player('P1').tags).toContain('immune南蛮入侵');
      })
      .check('孟获获得南蛮入侵来源标记', ctx => {
        expect(ctx.player('P1').tags).toContain('南蛮入侵来源');
      })
      .run();
  });

  describe('再起', () => {
    scenario('再起技能注册检查（受伤时可触发）')
      .setup(ctx => {
        ctx.selectCharacters('孟获', '刘备');
        ctx.setHealth('P1', 2);
      })
      .check('孟获有再起技能触发器', ctx => {
        const triggers = ctx.state.triggers.filter(
          t => t.player === 'P1' && t.skillId === '再起',
        );
        expect(triggers.length).toBeGreaterThan(0);
      })
      .run();

    scenario('满血时不触发再起效果')
      .setup(ctx => {
        ctx.selectCharacters('孟获', '刘备');
      })
      .act('触发摸牌阶段事件', ctx => {
        ctx.emitEvent({ type: '阶段开始', phase: '摸牌', player: 'P1' });
      })
      .check('孟获没有再起/skipNormalDraw变量（满血不触发）', ctx => {
        expect(ctx.player('P1').vars['再起/skipNormalDraw']).toBeUndefined();
      })
      .run();
  });
});
