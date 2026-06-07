import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('青龙偃月刀 - chaseDodge', () => {
  scenario('装备青龙偃月刀后杀被闪抵消，触发追杀 prompt')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '刘备');
      ctx.giveCard('P1', '青龙偃月刀');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const weaponId = ctx.findCard('P1', '青龙偃月刀')!;
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
    .check('触发青龙偃月刀追杀 prompt', ctx => {
      expect(ctx.isPending()).toBe(true);
      expect(ctx.pendingType()).toBe('技能选择');
    })
    .run();

  scenario('选择不追杀则无额外效果')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '刘备');
      ctx.giveCard('P1', '青龙偃月刀');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const weaponId = ctx.findCard('P1', '青龙偃月刀')!;
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
    .check('选择不追杀', ctx => {
      expect(ctx.pendingType()).toBe('技能选择');
      ctx.engineAction({ type: '技能选择', player: 'P1', choice: false });
    })
    .check('无额外伤害', ctx => {
      const diff = ctx.diff('equipped');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .run();
});
