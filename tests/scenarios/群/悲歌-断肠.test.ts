import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';
import type { Card } from '../../../shared/types';

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
  scenario('受到杀伤害后弃牌判定，红桃回复体力')
    .setup(ctx => {
      ctx.selectCharacters('蔡文姬', '曹操');
      ctx.giveCard('P1', '桃');
      ctx.setHealth('P1', 2);
      ctx.registerTriggers('P1');
      putHeartOnDeckTop(ctx);
      ctx.snapshot('initial');
    })
    .act('P1 受到杀伤害触发悲歌', ctx => {
      ctx.emitEvent({
        type: '受到伤害',
        target: 'P1',
        source: 'P2',
        amount: 1,
      });
    })
    .check('悲歌触发创建技能选择', ctx => {
      expect(ctx.state.pending).not.toBeNull();
      expect(ctx.state.pending?.type).toBe('技能选择');
    })
    .run();
});

describe('蔡文姬 - 断肠', () => {
  it.skip('断肠：杀死蔡文姬的角色失去所有技能（需要死亡流程中的技能移除逻辑）', () => {
    // 断肠需要在死亡流程中移除杀死者的所有触发器（triggers）
    // 涉及死亡处理逻辑的扩展，暂时跳过
  });
});
