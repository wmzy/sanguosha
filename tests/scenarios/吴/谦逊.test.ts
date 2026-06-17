// LEGACY TEST: references deleted v2 modules - skipped
import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';
// import { isValidTarget } from '@engine/validate';  // LEGACY: removed (v2 module deleted)

describe.skip('陆逊 - 谦逊', () => {
  scenario('陆逊不能被过河拆桥指定为目标')
    .setup(ctx => {
      ctx.selectCharacters('刘备', '陆逊');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '过河拆桥');
      ctx.giveCard('P2', '杀');
    })
    .check('过河拆桥不能指定P2(陆逊)为目标', ctx => {
      const cardId = ctx.findCard('P1', '过河拆桥');
      expect(isValidTarget(ctx.state, 'P1', cardId!, 'P2')).toBe(false);
    })
    .run();

  scenario('陆逊不能被顺手牵羊指定为目标')
    .setup(ctx => {
      ctx.selectCharacters('刘备', '陆逊');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '顺手牵羊');
      ctx.giveCard('P2', '杀');
    })
    .check('顺手牵羊不能指定P2(陆逊)为目标', ctx => {
      const cardId = ctx.findCard('P1', '顺手牵羊');
      expect(isValidTarget(ctx.state, 'P1', cardId!, 'P2')).toBe(false);
    })
    .run();

  scenario('其他角色可以正常被指定')
    .setup(ctx => {
      ctx.selectCharacters('陆逊', '刘备');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '过河拆桥');
      ctx.giveCard('P2', '杀');
    })
    .check('过河拆桥可以指定P2(刘备)为目标', ctx => {
      const cardId = ctx.findCard('P1', '过河拆桥');
      expect(isValidTarget(ctx.state, 'P1', cardId!, 'P2')).toBe(true);
    })
    .run();
});
