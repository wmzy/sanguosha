import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenario-runner';
import type { Card } from '../../../src/shared/types';

function giveBlackBasic(ctx: any, player: string) {
  const cardId = 'test-black-杀-1';
  const card: Card = {
    id: cardId,
    name: '杀',
    type: '基本牌',
    subtype: '杀',
    suit: '♠',
    rank: '7',
    description: '',
  };
  const p = ctx.state.players[player];
  ctx.state = {
    ...ctx.state,
    cardMap: { ...ctx.state.cardMap, [cardId]: card },
    players: { ...ctx.state.players, [player]: { ...p, hand: [...p.hand, cardId] } },
  };
  return cardId;
}

describe.skip('徐晃 - 断粮', () => {
  scenario('将黑色基本牌当兵粮寸断使用')
    .setup(ctx => {
      ctx.selectCharacters('徐晃', '刘备');
      giveBlackBasic(ctx, 'P1');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('使用断粮技能', ctx => {
      ctx.useSkill('P1', '断粮');
    })
    .check('创建技能提示选择牌和目标', ctx => {
      expect(ctx.state.pending).not.toBeNull();
      expect(ctx.state.pending?.type).toBe('技能选择');
    })
    .act('选择黑色杀和目标P2', ctx => {
      const cardId = ctx.findCard('P1', '杀')!;
      ctx.engineAction({ type: '技能选择', player: 'P1', choice: { cardIds: [cardId], player: 'P2' } });
    })
    .check('P2获得兵粮寸断延时锦囊', ctx => {
      const p2 = ctx.player('P2');
      expect(p2.pendingTricks.length).toBeGreaterThan(0);
      expect(p2.pendingTricks[0].name).toBe('兵粮寸断');
    })
    .check('P1手牌减少', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeLessThan(0);
    })
    .run();

  scenario('断粮技能注册检查')
    .setup(ctx => {
      ctx.selectCharacters('徐晃', '刘备');
      ctx.registerTriggers('P1');
    })
    .check('P1 拥有断粮触发器', ctx => {
      const hasTrigger = ctx.state.triggers.some(
        t => t.player === 'P1' && t.skillId === '断粮',
      );
      expect(hasTrigger).toBe(true);
    })
    .run();
});
