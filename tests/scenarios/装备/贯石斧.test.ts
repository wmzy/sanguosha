import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('贯石斧 - forceHit', () => {
  scenario('装备贯石斧后杀被闪抵消，触发强制命中 prompt')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '刘备');
      ctx.giveCard('P1', '贯石斧');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.giveCard('P1', '桃', 2);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const weaponId = ctx.findCard('P1', '贯石斧')!;
      ctx.playCard('P1', weaponId);
      ctx.snapshot('equipped');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 出闪抵消', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeId);
    })
    .check('触发贯石斧强制命中 prompt', ctx => {
      expect(ctx.isPending()).toBe(true);
      expect(ctx.pendingType()).toBe('skillPrompt');
    })
    .run();

  scenario('选择不弃牌则无强制命中')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '刘备');
      ctx.giveCard('P1', '贯石斧');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.giveCard('P1', '桃', 2);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const weaponId = ctx.findCard('P1', '贯石斧')!;
      ctx.playCard('P1', weaponId);
      ctx.snapshot('equipped');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 出闪抵消', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeId);
    })
    .check('选择不弃牌', ctx => {
      expect(ctx.pendingType()).toBe('skillPrompt');
      ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: false });
    })
    .check('P2 无伤害', ctx => {
      const diff = ctx.diff('equipped');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .run();
});
