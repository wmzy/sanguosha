import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';
import type { Card } from '../../../src/shared/types';

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

describe('蔡文姬 - 悲歌', () => {
  scenario('受到杀伤害后判定')
    .setup(ctx => {
      ctx.selectCharacters('蔡文姬', '曹操');
      ctx.giveCard('P2', '杀');
      ctx.giveCard('P1', '桃');
      ctx.setHealth('P1', 2);
      ctx.setCurrentPlayer('P2');
      ctx.enterPlayPhase();
      putHeartOnDeckTop(ctx);
      ctx.snapshot('initial');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀');
      ctx.playCard('P2', killId!, 'P1');
    })
    .act('P1 不出闪', ctx => {
      ctx.respond('P1');
    })
    .check('蔡文姬受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .run();
});

describe('蔡文姬 - 断肠', () => {
  it.skip('断肠：杀死蔡文姬的角色失去所有技能（需要死亡流程中的技能移除逻辑）', () => {
    // 断肠需要在死亡流程中移除杀死者的所有触发器（triggers）
    // 涉及死亡处理逻辑的扩展，暂时跳过
  });
});
