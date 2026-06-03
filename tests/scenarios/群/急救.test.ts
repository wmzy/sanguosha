import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('华佗 - 急救', () => {
  scenario('华佗用红色手牌当桃救濒死的其他角色')
    .setup(ctx => {
      ctx.selectCharacters('华佗', '刘备');
      ctx.setHealth('P2', 1);
      ctx.giveCard('P1', '杀');
      // 给华佗一张红色锦囊（♥无中生有）用于急救
      ctx.giveCard('P1', '无中生有');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 不出闪', ctx => {
      ctx.respond('P2');
    })
    .check('P2 进入濒死', ctx => {
      expect(ctx.state.pending?.type).toBe('dyingWindow');
      if (ctx.state.pending?.type === 'dyingWindow') {
        expect(ctx.state.pending.dyingPlayer).toBe('P2');
        // P2 先自救，然后轮到 P1
        expect(ctx.state.pending.savers[0]).toBe('P2');
        expect(ctx.state.pending.savers[1]).toBe('P1');
      }
    })
    .act('P2 没有桃，跳过', ctx => {
      ctx.respond('P2');
    })
    .act('华佗(P1) 用红色手牌(无中生有♥)当桃救 P2', ctx => {
      const redCard = ctx.findCard('P1', '无中生有')!;
      expect(redCard).toBeDefined();
      // 确认这张牌是红色
      const card = ctx.state.cardMap[redCard];
      expect(card.suit).toMatch(/[♥♦]/);
      ctx.respond('P1', redCard);
    })
    .check('P2 被救活，血量恢复到 1', ctx => {
      const diff = ctx.diff('initial');
      // P2 从 1 被打到 0，被桃救回 1 → 净变化 0
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .check('华佗手牌减少（用了红色牌救人）', ctx => {
      const diff = ctx.diff('initial');
      // P1 给了杀 + 无中生有，初始手牌已包含这些
      expect(diff.handSizeChanges['P1']).toBeLessThan(0);
    })
    .run();

  scenario('华佗用黑色手牌不能当桃救濒死角色')
    .setup(ctx => {
      ctx.selectCharacters('华佗', '刘备');
      ctx.setHealth('P2', 1);
      const p1 = ctx.player('P1');
      const p2 = ctx.player('P2');
      const allHand = [...p1.hand, ...p2.hand];
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P1: { ...p1, hand: [] },
          P2: { ...p2, hand: [] },
        },
        zones: {
          ...ctx.state.zones,
          deck: [...ctx.state.zones.deck, ...allHand],
        },
      };
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P1', '过河拆桥');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 不出闪', ctx => {
      ctx.respond('P2');
    })
    .act('P2 没有桃跳过', ctx => {
      ctx.respond('P2');
    })
    .check('轮到华佗救助', ctx => {
      expect(ctx.state.pending?.type).toBe('dyingWindow');
    })
    .act('华佗也没有桃跳过', ctx => {
      ctx.respond('P1');
    })
    .check('华佗黑色手牌不能用于急救——P2 死亡', ctx => {
      const p2 = ctx.player('P2');
      expect(p2.info.alive).toBe(false);
    })
    .run();

  scenario('华佗用桃救濒死角色（正常桃也有效）')
    .setup(ctx => {
      ctx.selectCharacters('华佗', '刘备');
      ctx.setHealth('P2', 1);
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P1', '桃');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 不出闪', ctx => {
      ctx.respond('P2');
    })
    .act('P2 没有桃跳过', ctx => {
      ctx.respond('P2');
    })
    .act('华佗(P1) 用真正的桃救 P2', ctx => {
      const peachId = ctx.findCard('P1', '桃')!;
      ctx.respond('P1', peachId);
    })
    .check('P2 被救活', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .run();
});
