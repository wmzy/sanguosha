import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('贾诩 - 帷幕（v3 registerAtomHook）', () => {
  scenario('黑桃过河拆桥指定贾诩为目标：becomeTarget 被 cancel')
    .setup(ctx => {
      ctx.selectCharacters('贾诩', '曹操');
      // 给 P2 一张过河拆桥（默认花色 ♠，黑桃属黑色锦囊）
      ctx.giveCard('P2', '过河拆桥');
    })
    .act('对贾诩应用黑桃过河拆桥的 becomeTarget atom', ctx => {
      const cardId = ctx.findCard('P2', '过河拆桥')!;
      const card = ctx.state.cardMap[cardId];
      // 确保是黑桃（fixture 默认 ♠）
      expect(card.suit).toBe('♠');
      ctx.applyAtoms([
        {
          type: 'becomeTarget',
          cardId,
          source: 'P2',
          target: 'P1',
        },
      ]);
    })
    .check('serverLog 末尾不是 becomeTarget 事件（被 cancel）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.type).not.toBe('becomeTarget');
    })
    .run();

  scenario('红桃五谷丰登指定贾诩为目标：becomeTarget 通过')
    .setup(ctx => {
      ctx.selectCharacters('贾诩', '曹操');
      // 红桃五谷丰登：直接构造（fixture 默认 ♥）
      ctx.giveCard('P2', '五谷丰登');
      const wgfdId = ctx.findCard('P2', '五谷丰登')!;
      // 改花色为红桃
      ctx.state = {
        ...ctx.state,
        cardMap: {
          ...ctx.state.cardMap,
          [wgfdId]: { ...ctx.state.cardMap[wgfdId], suit: '♥' },
        },
      };
    })
    .act('对贾诩应用红桃五谷丰登的 becomeTarget atom', ctx => {
      const wgfdId = ctx.findCard('P2', '五谷丰登')!;
      ctx.applyAtoms([
        {
          type: 'becomeTarget',
          cardId: wgfdId,
          source: 'P2',
          target: 'P1',
        },
      ]);
    })
    .check('serverLog 末尾是 becomeTarget 事件（红色锦囊不阻）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.type).toBe('becomeTarget');
    })
    .run();

  scenario('黑桃过河拆桥指定非贾诩为目标：becomeTarget 通过')
    .setup(ctx => {
      ctx.selectCharacters('贾诩', '曹操');
      ctx.giveCard('P1', '过河拆桥');
    })
    .act('对曹操应用黑桃过河拆桥的 becomeTarget atom', ctx => {
      const cardId = ctx.findCard('P1', '过河拆桥')!;
      ctx.applyAtoms([
        {
          type: 'becomeTarget',
          cardId,
          source: 'P1',
          target: 'P2',
        },
      ]);
    })
    .check('serverLog 末尾是 becomeTarget 事件（目标非贾诩）', ctx => {
      const last = ctx.state.serverLog[ctx.state.serverLog.length - 1];
      expect(last?.type).toBe('becomeTarget');
    })
    .run();
});

describe('贾诩 - 乱武（暂跳过）', () => {
  it.skip('乱武：限定技，复杂 AOE 链式交互', () => {
    // P2+ 任务
  });
});
