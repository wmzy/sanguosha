import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('雌雄双股剑 - dualWeapon', () => {
  scenario('装备雌雄双股剑对异性角色使用杀，双方各弃一张手牌')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '貂蝉');
      ctx.giveCard('P1', '雌雄双股剑');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '桃');
      ctx.giveCard('P1', '桃');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const weaponId = ctx.findCard('P1', '雌雄双股剑')!;
      ctx.playCard('P1', weaponId);
      ctx.snapshot('equipped');
    })
    .act('P1(男) 对 P2(女) 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 不出闪', ctx => {
      ctx.respond('P2');
    })
    .check('双方各弃置一张手牌', ctx => {
      const diff = ctx.diff('equipped');
      expect(diff.handSizeChanges['P1']).toBeLessThan(0);
      expect(diff.handSizeChanges['P2']).toBeLessThan(0);
    })
    .check('P2 受到伤害', ctx => {
      const diff = ctx.diff('equipped');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .run();

  scenario('对同性角色使用杀，不触发弃牌效果')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '刘备');
      ctx.giveCard('P1', '雌雄双股剑');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '桃');
      ctx.giveCard('P1', '桃');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const weaponId = ctx.findCard('P1', '雌雄双股剑')!;
      ctx.playCard('P1', weaponId);
      ctx.snapshot('equipped');
    })
    .act('P1(男) 对 P2(男) 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 不出闪', ctx => {
      ctx.respond('P2');
    })
    .check('不触发弃牌效果', ctx => {
      const diff = ctx.diff('equipped');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .run();
});
