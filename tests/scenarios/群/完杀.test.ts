import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('贾诩 - 完杀（v3 registerAtomHook）', () => {
  scenario('源=贾诩且 target != source：heal atom 被 cancel')
    .setup(ctx => {
      ctx.selectCharacters('贾诩', '曹操');
      // 当前 P1=贾诩（main character）
    })
    .act('贾诩对曹操应用 heal atom', ctx => {
      const p2Before = ctx.state.players.P2.health;
      ctx.applyAtoms([
        { type: 'heal', target: 'P2', amount: 1, source: 'P1' },
      ]);
      // P2 体力不变（heal 被 cancel）
      expect(ctx.state.players.P2.health).toBe(p2Before);
    })
    .check('serverLog 末尾不是 heal 事件（被 cancel）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.type).not.toBe('heal');
    })
    .run();

  scenario('源=贾诩且 target == source：heal 通过（救自己不阻）')
    .setup(ctx => {
      ctx.selectCharacters('贾诩', '曹操');
      ctx.setHealth('P1', 2);
    })
    .act('贾诩对自己应用 heal atom', ctx => {
      ctx.applyAtoms([
        { type: 'heal', target: 'P1', amount: 1, source: 'P1' },
      ]);
    })
    .check('P1 体力 +1', ctx => {
      expect(ctx.state.players.P1.health).toBe(3);
    })
    .check('serverLog 末尾是 heal 事件', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.type).toBe('heal');
    })
    .run();

  scenario('源不是贾诩：heal 不会被完杀拦截')
    .setup(ctx => {
      // P1 是非贾诩武将（如曹操）
      ctx.selectCharacters('曹操', '刘备');
      ctx.setHealth('P2', 2);
    })
    .act('P2 对自己应用 heal atom', ctx => {
      ctx.applyAtoms([
        { type: 'heal', target: 'P2', amount: 1, source: 'P2' },
      ]);
    })
    .check('P2 体力 +1（完杀不适用）', ctx => {
      expect(ctx.state.players.P2.health).toBe(3);
    })
    .run();
});
