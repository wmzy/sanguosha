import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('诸葛亮 - 空城（v2 validation 路径）', () => {
  scenario('诸葛亮无手牌时不能成为杀的目标')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '诸葛亮');
      ctx.giveCard('P1', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const p2 = ctx.player('P2');
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P2: { ...p2, hand: [] },
        },
      };
      ctx.snapshot('initial');
    })
    .check('P2 无手牌', ctx => {
      expect(ctx.handSize('P2')).toBe(0);
    })
    .act('P1 尝试对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      expect(() => ctx.playCard('P1', killId, 'P2')).toThrow();
    })
    .check('P2 未受伤', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .run();

  scenario('诸葛亮有手牌时可以成为杀的目标')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '诸葛亮');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .check('杀成功指定 P2（进入响应窗口）', ctx => {
      expect(ctx.state.pending?.type).toBe('响应窗口');
    })
    .run();
});

describe('诸葛亮 - 空城（v3 registerAtomHook 路径）', () => {
  scenario('诸葛亮手牌空 + 杀指定为目标：becomeTarget 被 cancel')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '诸葛亮');
      ctx.giveCard('P1', '杀');
      // 清空 P2 手牌
      const p2 = ctx.player('P2');
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P2: { ...p2, hand: [] },
        },
      };
    })
    .act('对诸葛亮应用杀的 becomeTarget atom', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.applyAtoms([
        {
          type: '成为目标',
          cardId: killId,
          source: 'P1',
          target: 'P2',
        },
      ]);
    })
    .check('serverLog 末尾不是 becomeTarget 事件（被 cancel）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.atom.type).not.toBe('成为目标');
    })
    .run();

  scenario('诸葛亮有手牌 + 杀指定：becomeTarget 通过')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '诸葛亮');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
    })
    .act('对诸葛亮应用杀的 becomeTarget atom', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.applyAtoms([
        {
          type: '成为目标',
          cardId: killId,
          source: 'P1',
          target: 'P2',
        },
      ]);
    })
    .check('serverLog 末尾是 becomeTarget 事件（有手牌不阻）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.atom.type).toBe('成为目标');
    })
    .run();

  scenario('非诸葛亮 + 手牌空 + 杀指定：becomeTarget 通过（角色特化）')
    .setup(ctx => {
      // P1=曹操（无空城），P2=刘备（无空城）但 P2 手牌空
      ctx.selectCharacters('曹操', '刘备');
      ctx.giveCard('P1', '杀');
      const p2 = ctx.player('P2');
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P2: { ...p2, hand: [] },
        },
      };
    })
    .act('对刘备（非空城）应用杀的 becomeTarget atom', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.applyAtoms([
        {
          type: '成为目标',
          cardId: killId,
          source: 'P1',
          target: 'P2',
        },
      ]);
    })
    .check('serverLog 末尾是 becomeTarget 事件（无空城）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.atom.type).toBe('成为目标');
    })
    .run();
});
