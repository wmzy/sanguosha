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

  scenario('贾诩回合 + 目标濒死：heal 通过（濒死豁免）')
    .setup(ctx => {
      ctx.selectCharacters('贾诩', '曹操');
      // P2 体力归零，模拟濒死状态
      ctx.setHealth('P2', 0);
    })
    .act('P1（贾诩）对濒死的 P2 应用 heal atom', ctx => {
      ctx.applyAtoms([
        { type: 'heal', target: 'P2', amount: 1, source: 'P1' },
      ]);
    })
    .check('P2 体力 +1（濒死豁免）', ctx => {
      expect(ctx.state.players.P2.health).toBe(1);
    })
    .check('serverLog 末尾是 heal 事件（未被 cancel）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.type).toBe('heal');
    })
    .run();

  scenario('贾诩回合 + 目标存活：heal 被 cancel（非濒死不豁免）')
    .setup(ctx => {
      ctx.selectCharacters('贾诩', '曹操');
      ctx.setHealth('P2', 2);
    })
    .act('P1（贾诩）对存活的 P2 应用 heal atom', ctx => {
      ctx.applyAtoms([
        { type: 'heal', target: 'P2', amount: 1, source: 'P1' },
      ]);
    })
    .check('P2 体力不变（heal 被 cancel）', ctx => {
      expect(ctx.state.players.P2.health).toBe(2);
    })
    .check('serverLog 末尾不是 heal 事件（被 cancel）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.type).not.toBe('heal');
    })
    .run();

  scenario('非贾诩回合：heal 不被 完杀 拦截（回合外不生效）')
    .setup(ctx => {
      // P1 = 贾诩, P2 = 曹操
      ctx.selectCharacters('贾诩', '曹操');
      // 把 currentPlayer 切到 P2（非贾诩的回合）
      ctx.setCurrentPlayer('P2');
      ctx.setHealth('P1', 2);
    })
    .act('P2 对贾诩应用 heal atom', ctx => {
      ctx.applyAtoms([
        { type: 'heal', target: 'P1', amount: 1, source: 'P2' },
      ]);
    })
    .check('P1 体力 +1（完杀 仅贾诩的回合生效）', ctx => {
      expect(ctx.state.players.P1.health).toBe(3);
    })
    .check('serverLog 末尾是 heal 事件（未 cancel）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.type).toBe('heal');
    })
    .run();
});
