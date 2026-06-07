import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';
import type { Card } from '../../../src/shared/types';

function putRedCardOnDeckTop(ctx: any) {
  const cardId = 'test-red-judge';
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

function putBlackCardOnDeckTop(ctx: any) {
  const cardId = 'test-black-judge';
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

describe('马超 - 铁骑', () => {
  scenario('铁骑判定红色后目标无法出闪')
    .setup(ctx => {
      ctx.selectCharacters('马超', '曹操');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      putRedCardOnDeckTop(ctx);
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .check('P2 有 cannotDodge tag（铁骑判定红色）', ctx => {
      const p2 = ctx.player('P2');
      expect(p2.tags).toContain('cannotDodge');
    })
    .act('P2 尝试用闪响应（应失败，因为有 cannotDodge）', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      expect(() => ctx.respond('P2', dodgeId)).toThrow();
    })
    .act('P2 放弃响应', ctx => {
      ctx.respond('P2');
    })
    .check('P2 受到伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .run();

  scenario('铁骑判定黑色后目标可以正常出闪')
    .setup(ctx => {
      ctx.selectCharacters('马超', '曹操');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      putBlackCardOnDeckTop(ctx);
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .check('P2 没有 cannotDodge tag（铁骑判定黑色）', ctx => {
      const p2 = ctx.player('P2');
      expect(p2.tags).not.toContain('cannotDodge');
    })
    .act('P2 正常用闪响应', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeId);
    })
    .check('P2 未受伤', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .run();
});
