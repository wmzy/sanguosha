import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';
import type { Card } from '../../../shared/types';

function setupDeckWithTwoCards(ctx: any) {
  const card1Id = 'deck-top-1';
  const card2Id = 'deck-top-2';
  const card1: Card = {
    id: card1Id,
    name: '闪',
    type: '基本牌',
    subtype: '闪',
    suit: '♥',
    rank: 'K',
    description: '',
  };
  const card2: Card = {
    id: card2Id,
    name: '杀',
    type: '基本牌',
    subtype: '杀',
    suit: '♠',
    rank: '7',
    description: '',
  };
  ctx.state = {
    ...ctx.state,
    cardMap: { ...ctx.state.cardMap, [card1Id]: card1, [card2Id]: card2 },
    zones: { ...ctx.state.zones, deck: [card1Id, card2Id, ...ctx.state.zones.deck] },
  };
  return { card1Id, card2Id };
}

describe.skip('颜良文丑 - 双雄', () => {
  scenario('摸牌阶段发动双雄展示两张牌并选择花色')
    .setup(ctx => {
      ctx.selectCharacters('颜良文丑', '曹操');
      ctx.setCurrentPlayer('P1');
      setupDeckWithTwoCards(ctx);
      ctx.snapshot('initial');
    })
    .act('发射摸牌阶段开始事件触发双雄', ctx => {
      ctx.emitEvent({
        type: '阶段开始',
        phase: '摸牌',
        player: 'P1',
      });
    })
    .check('双雄触发后创建技能选择提示', ctx => {
      expect(ctx.state.pending).not.toBeNull();
      expect(ctx.state.pending?.type).toBe('技能选择');
      const prompt = ctx.state.pending as any;
      expect(prompt.skillId).toBe('双雄');
    })
    .run();

  scenario('选择一张牌后获得花色标记并跳过正常摸牌')
    .setup(ctx => {
      ctx.selectCharacters('颜良文丑', '曹操');
      ctx.setCurrentPlayer('P1');
      setupDeckWithTwoCards(ctx);
      ctx.snapshot('initial');
    })
    .act('发射摸牌阶段开始事件触发双雄', ctx => {
      ctx.emitEvent({
        type: '阶段开始',
        phase: '摸牌',
        player: 'P1',
      });
    })
    .act('选择牌堆顶第二张牌（♠杀）', ctx => {
      ctx.engineAction({ type: '技能选择', player: 'P1', choice: 'deck-top-2' });
    })
    .check('获得花色标记', ctx => {
      const p1 = ctx.player('P1');
      expect(p1.vars['双雄/chosenSuit']).toBe('♠');
    })
    .check('手牌增加（摸了2张，弃了1张）', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBe(1);
    })
    .check('设置了跳过摸牌标记', ctx => {
      const p1 = ctx.player('P1');
      expect(p1.tags).toContain('skipDraw');
    })
    .run();
});
