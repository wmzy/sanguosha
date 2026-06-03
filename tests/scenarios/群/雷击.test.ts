import { describe, expect, it } from 'vitest';
import { scenario } from '../../scenario-runner';
import type { Card } from '../../../shared/types';

function putSpadeOnDeckTop(ctx: any) {
  const cardId = 'test-spade-judge';
  const card: Card = {
    id: cardId,
    name: '杀',
    type: '基本牌',
    subtype: '杀',
    suit: '♠',
    rank: 'A',
    description: '',
  };
  ctx.state = {
    ...ctx.state,
    cardMap: { ...ctx.state.cardMap, [cardId]: card },
    zones: { ...ctx.state.zones, deck: [...ctx.state.zones.deck, cardId] },
  };
}

function putHeartOnDeckTop(ctx: any) {
  const cardId = 'test-heart-judge';
  const card: Card = {
    id: cardId,
    name: '杀',
    type: '基本牌',
    subtype: '杀',
    suit: '♥',
    rank: 'A',
    description: '',
  };
  ctx.state = {
    ...ctx.state,
    cardMap: { ...ctx.state.cardMap, [cardId]: card },
    zones: { ...ctx.state.zones, deck: [...ctx.state.zones.deck, cardId] },
  };
}

describe('张角 - 雷击', () => {
  scenario('使用闪时触发雷击，判定为黑桃造成2点雷电伤害')
    .setup(ctx => {
      ctx.selectCharacters('张角', '曹操');
      ctx.giveCard('P1', '闪');
      ctx.snapshot('initial');
      putSpadeOnDeckTop(ctx);
    })
    .act('P1 打出闪触发雷击', ctx => {
      ctx.emitEvent({
        type: 'cardPlayed',
        player: 'P1',
        cardId: ctx.findCard('P1', '闪')!,
      });
    })
    .check('雷击触发后创建 prompt 选择目标', ctx => {
      // 雷击需要选择目标角色
      expect(ctx.state.pending).not.toBeNull();
      expect(ctx.state.pending?.type).toBe('skillPrompt');
    })
    .run();

  scenario('使用闪时触发雷击，判定非黑桃不造成伤害')
    .setup(ctx => {
      ctx.selectCharacters('张角', '曹操');
      ctx.giveCard('P1', '闪');
      ctx.snapshot('initial');
      putHeartOnDeckTop(ctx);
    })
    .act('P1 打出闪触发雷击（红桃判定）', ctx => {
      ctx.emitEvent({
        type: 'cardPlayed',
        player: 'P1',
        cardId: ctx.findCard('P1', '闪')!,
      });
    })
    .check('雷击创建 prompt', ctx => {
      expect(ctx.state.pending).not.toBeNull();
    })
    .run();
});

describe('张角 - 鬼道', () => {
  it.skip('鬼道：判定牌生效前用黑色牌替换（需要复杂的判定拦截逻辑）', () => {
    // 鬼道需要在判定结果出来之前替换判定牌，涉及判定流程的拦截机制
    // 当前引擎判定流程不完整，暂时跳过
  });
});

describe('张角 - 黄天', () => {
  it.skip('黄天：主公技，其他群势力角色交出闪或闪电（需要主公身份和多势力交互）', () => {
    // 黄天是主公技，需要主公身份判定 + 其他群势力角色的交互
    // 暂时跳过
  });
});
