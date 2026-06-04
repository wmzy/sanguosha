import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('郭嘉 - 遗计', () => {
  scenario('受到伤害后摸两张牌')
    .setup(ctx => {
      ctx.selectCharacters('郭嘉', '刘备');
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P2');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.playCard('P2', killId, 'P1');
    })
    .act('P1 不出闪', ctx => {
      ctx.respond('P1');
    })
    .check('郭嘉受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .check('遗计触发：手牌 +2', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(2);
    })
    .run();

  scenario('摸牌后出现分配提示')
    .setup(ctx => {
      ctx.selectCharacters('郭嘉', '刘备');
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P2');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.playCard('P2', killId, 'P1');
    })
    .act('P1 不出闪', ctx => {
      ctx.respond('P1');
    })
    .act('跳过分配（选择不分配）', ctx => {
      // 遗计的分配是可选的，跳过后不应改变手牌
      if (ctx.state.pending?.type === 'skillPrompt') {
        ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: false });
      }
    })
    .check('不分配时手牌保持摸牌后的数量', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(2);
    })
    .run();

  scenario('分配牌给其他角色')
    .setup(ctx => {
      ctx.selectCharacters('郭嘉', '刘备');
      ctx.giveCard('P1', '桃');
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P2');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.playCard('P2', killId, 'P1');
    })
    .act('P1 不出闪', ctx => {
      ctx.respond('P1');
    })
    .act('选择1张牌分配', ctx => {
      if (ctx.state.pending?.type === 'skillPrompt') {
        const cardId = ctx.findCard('P1', '桃');
        if (cardId) {
          ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: [cardId] });
        } else {
          ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: false });
        }
      }
    })
    .act('选择 P2 作为目标', ctx => {
      if (ctx.state.pending?.type === 'skillPrompt') {
        ctx.engineAction({ type: 'skillChoice', player: 'P1', choice: 'P2' });
      }
    })
    .check('P2 获得分配的牌', ctx => {
      const p2 = ctx.player('P2');
      const hasPeach = p2.hand.some(id => ctx.state.cardMap[id]?.name === '桃');
      expect(hasPeach).toBe(true);
    })
    .run();
});
