import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('貂蝉 - 闭月', () => {
  scenario('结束阶段摸一张牌（手牌不超上限，直接换人）')
    .setup(ctx => {
      ctx.selectCharacters('貂蝉', '刘备');
      // 貂蝉 maxHealth=3, 设 health=3 且清空手牌使 handSize <= health
      ctx.setHealth('P1', 3);
      // 把 P1 手牌全部放回牌堆，使手牌 = 0 ≤ health = 3
      const hand = [...ctx.player('P1').hand];
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P1: { ...ctx.player('P1'), hand: [] },
        },
        zones: {
          ...ctx.state.zones,
          deck: [...ctx.state.zones.deck, ...hand],
        },
      };
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('结束回合', ctx => {
      ctx.endTurn('P1');
    })
    .check('闭月触发：手牌 +1（原 0 → 闭月摸 1）', ctx => {
      expect(ctx.handSize('P1')).toBe(1);
    })
    .check('进入 P2 的出牌阶段', ctx => {
      expect(ctx.state.currentPlayer).toBe('P2');
      expect(ctx.state.phase).toBe('出牌');
    })
    .run();

  scenario('结束阶段摸一张牌（手牌超上限，先闭月再弃牌）')
    .setup(ctx => {
      ctx.selectCharacters('貂蝉', '刘备');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('结束回合', ctx => {
      ctx.endTurn('P1');
    })
    .check('闭月先触发：手牌比初始多 1', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(1);
    })
    .check('因手牌数超过体力，进入弃牌阶段', ctx => {
      expect(ctx.isPending()).toBe(true);
      expect(ctx.pendingType()).toBe('discardPhase');
    })
    .run();
});
