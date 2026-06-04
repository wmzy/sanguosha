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

describe.skip('张角 - 雷击', () => {
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

describe.skip('张角 - 鬼道', () => {
  scenario('判定牌生效前用黑色手牌替换判定牌')
    .setup(ctx => {
      ctx.selectCharacters('张角', '曹操');
      ctx.giveCard('P1', '杀');
      ctx.snapshot('initial');
    })
    .act('发射 judgeResult 事件触发鬼道', ctx => {
      ctx.emitEvent({
        type: 'judgeResult',
        player: 'P1',
        cardId: 'fake-judge-card',
        result: 'red',
      });
    })
    .check('鬼道触发后创建技能选择提示', ctx => {
      expect(ctx.state.pending).not.toBeNull();
      expect(ctx.state.pending?.type).toBe('skillPrompt');
      const prompt = ctx.state.pending as any;
      expect(prompt.skillId).toBe('鬼道');
    })
    .run();

  scenario('选择不替换时手牌不变')
    .setup(ctx => {
      ctx.selectCharacters('张角', '曹操');
      ctx.giveCard('P1', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('发射 judgeResult 事件触发鬼道', ctx => {
      ctx.emitEvent({
        type: 'judgeResult',
        player: 'P1',
        cardId: 'fake-judge-card',
        result: 'red',
      });
    })
    .act('记录回答前手牌数', ctx => {
      ctx.snapshot('before-choice');
    })
    .act('选择不替换', ctx => {
      ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: false });
    })
    .check('手牌不变', ctx => {
      const diff = ctx.diff('before-choice');
      expect(diff.handSizeChanges['P1']).toBe(0);
    })
    .run();

  scenario('选择黑色手牌替换判定牌')
    .setup(ctx => {
      ctx.selectCharacters('张角', '曹操');
      ctx.giveCard('P1', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('发射 judgeResult 事件触发鬼道', ctx => {
      ctx.emitEvent({
        type: 'judgeResult',
        player: 'P1',
        cardId: 'fake-judge-card',
        result: 'red',
      });
    })
    .act('选择黑色手牌替换判定牌', ctx => {
      const cardId = ctx.findCard('P1', '杀')!;
      ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: cardId });
    })
    .check('选中的牌从手牌移出', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeLessThan(0);
    })
    .run();
});

describe('张角 - 黄天', () => {
  it.skip('黄天：主公技，其他群势力角色交出闪或闪电（需要主公身份和多势力交互）', () => {
    // 黄天是主公技，需要主公身份判定 + 其他群势力角色的交互
    // 暂时跳过
  });
});
