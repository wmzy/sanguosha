// tests/unit/effect.test.ts
import { describe, it, expect } from 'vitest';
import {
  useKill, usePeach,
  useDismantle, useSteal, useDrawTwo, useDuel,
  useArrowBarrage, useBarbarianInvasion, usePeachGarden, useAbundance,
} from '@engine/effect';
import { createGame } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';

describe('卡牌效果', () => {
  describe('useKill', () => {
    it('应该对目标造成1点伤害', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';

      const result = useKill(game, '曹操', '刘备');
      expect(result.success).toBe(true);
      const liuBei = result.status.players.find(p => p.name === '刘备')!;
      expect(liuBei.health).toBe(3);
    });

    it('不能对自己使用杀', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = useKill(game, '曹操', '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('usePeach', () => {
    it('应该恢复1点体力', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';
      game.players[0].health = 3;

      const result = usePeach(game, '曹操');
      expect(result.success).toBe(true);
      expect(result.status.players[0].health).toBe(4);
    });

    it('不能超过体力上限', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';
      // 曹操体力已满 (4/4)

      const result = usePeach(game, '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('useDismantle', () => {
    it('应该弃置目标一张手牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';
      game.players[1].hand = [
        { name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '3', description: '' },
      ];

      const result = useDismantle(game, '曹操', '刘备');
      expect(result.success).toBe(true);
      const liuBei = result.status.players.find(p => p.name === '刘备')!;
      expect(liuBei.hand.length).toBe(0);
      expect(result.status.discardPile.length).toBe(1);
    });

    it('目标没有手牌时失败', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      // 刘备没有手牌

      const result = useDismantle(game, '曹操', '刘备');
      expect(result.success).toBe(false);
    });

    it('不能对自己使用', () => {
      const game = createGame([曹操, 刘备]);
      const result = useDismantle(game, '曹操', '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('useSteal', () => {
    it('应该从目标获得一张手牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';
      game.players[1].hand = [
        { name: '闪', type: '基本牌', subtype: '闪', suit: '♥', rank: '3', description: '' },
      ];

      const result = useSteal(game, '曹操', '刘备');
      expect(result.success).toBe(true);
      const liuBei = result.status.players.find(p => p.name === '刘备')!;
      const caoCao = result.status.players.find(p => p.name === '曹操')!;
      expect(liuBei.hand.length).toBe(0);
      expect(caoCao.hand.length).toBe(1);
    });

    it('目标没有牌时失败', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = useSteal(game, '曹操', '刘备');
      expect(result.success).toBe(false);
    });
  });

  describe('useDrawTwo', () => {
    it('应该摸2张牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      const deckSize = game.deck.length;

      const result = useDrawTwo(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.status.players.find(p => p.name === '曹操')!;
      expect(caoCao.hand.length).toBe(2);
      expect(result.status.deck.length).toBe(deckSize - 2);
    });

    it('牌堆不足时失败', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.deck = [];

      const result = useDrawTwo(game, '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('useDuel', () => {
    it('应该对目标造成1点伤害', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = useDuel(game, '曹操', '刘备');
      expect(result.success).toBe(true);
      const liuBei = result.status.players.find(p => p.name === '刘备')!;
      expect(liuBei.health).toBe(3);
    });

    it('不能对自己使用', () => {
      const game = createGame([曹操, 刘备]);
      const result = useDuel(game, '曹操', '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('useArrowBarrage', () => {
    it('应该对所有其他存活玩家造成1点伤害', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = useArrowBarrage(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.status.players.find(p => p.name === '曹操')!;
      const liuBei = result.status.players.find(p => p.name === '刘备')!;
      expect(caoCao.health).toBe(4); // 使用者不受伤害
      expect(liuBei.health).toBe(3); // 目标受伤
    });
  });

  describe('useBarbarianInvasion', () => {
    it('应该对所有其他存活玩家造成1点伤害', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = useBarbarianInvasion(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.status.players.find(p => p.name === '曹操')!;
      const liuBei = result.status.players.find(p => p.name === '刘备')!;
      expect(caoCao.health).toBe(4);
      expect(liuBei.health).toBe(3);
    });
  });

  describe('usePeachGarden', () => {
    it('应该恢复所有存活玩家1点体力', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.players[0].health = 3;
      game.players[1].health = 2;

      const result = usePeachGarden(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.status.players.find(p => p.name === '曹操')!;
      const liuBei = result.status.players.find(p => p.name === '刘备')!;
      expect(caoCao.health).toBe(4);
      expect(liuBei.health).toBe(3);
    });

    it('不能超过体力上限', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      // 两人体力都已满

      const result = usePeachGarden(game, '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('useAbundance', () => {
    it('应该让每名存活玩家摸1张牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      const deckSize = game.deck.length;

      const result = useAbundance(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.status.players.find(p => p.name === '曹操')!;
      const liuBei = result.status.players.find(p => p.name === '刘备')!;
      expect(caoCao.hand.length).toBe(1);
      expect(liuBei.hand.length).toBe(1);
      expect(result.status.deck.length).toBe(deckSize - 2);
    });

    it('牌堆不足时失败', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.deck = [{ name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '3', description: '' }];

      const result = useAbundance(game, '曹操');
      expect(result.success).toBe(false);
    });
  });
});
