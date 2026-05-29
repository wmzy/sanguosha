// tests/unit/effect.test.ts
import { describe, it, expect } from 'vitest';
import {
  playKill, playPeach,
  playDismantle, playSteal, playDrawTwo, playDuel,
  playArrowBarrage, playBarbarianInvasion, playPeachGarden, playAbundance,
} from '@engine/effect';
import { createGame } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';

describe('卡牌效果', () => {
  describe('playKill', () => {
    it('应该对目标造成1点伤害', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';

      const result = playKill(game, '曹操', '刘备');
      expect(result.success).toBe(true);
      const liuBei = result.state.players.find(p => p.name === '刘备')!;
      expect(liuBei.health).toBe(3);
    });

    it('不能对自己使用杀', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = playKill(game, '曹操', '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('playPeach', () => {
    it('应该恢复1点体力', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';
      game.players[0].health = 3;

      const result = playPeach(game, '曹操');
      expect(result.success).toBe(true);
      expect(result.state.players[0].health).toBe(4);
    });

    it('不能超过体力上限', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';
      // 曹操体力已满 (4/4)

      const result = playPeach(game, '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('playDismantle', () => {
    it('应该弃置目标一张手牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';
      game.players[1].hand = [
        { id: '杀-♠-3', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '3', description: '' },
      ];

      const result = playDismantle(game, '曹操', '刘备');
      expect(result.success).toBe(true);
      const liuBei = result.state.players.find(p => p.name === '刘备')!;
      expect(liuBei.hand.length).toBe(0);
      expect(result.state.discardPile.length).toBe(1);
    });

    it('目标没有手牌时失败', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      // 刘备没有手牌

      const result = playDismantle(game, '曹操', '刘备');
      expect(result.success).toBe(false);
    });

    it('不能对自己使用', () => {
      const game = createGame([曹操, 刘备]);
      const result = playDismantle(game, '曹操', '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('playSteal', () => {
    it('应该从目标获得一张手牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.currentPlayer = '曹操';
      game.players[1].hand = [
        { id: '闪-♥-3', name: '闪', type: '基本牌', subtype: '闪', suit: '♥', rank: '3', description: '' },
      ];

      const result = playSteal(game, '曹操', '刘备');
      expect(result.success).toBe(true);
      const liuBei = result.state.players.find(p => p.name === '刘备')!;
      const caoCao = result.state.players.find(p => p.name === '曹操')!;
      expect(liuBei.hand.length).toBe(0);
      expect(caoCao.hand.length).toBe(1);
    });

    it('目标没有牌时失败', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = playSteal(game, '曹操', '刘备');
      expect(result.success).toBe(false);
    });
  });

  describe('playDrawTwo', () => {
    it('应该摸2张牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      const deckSize = game.deck.length;

      const result = playDrawTwo(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.state.players.find(p => p.name === '曹操')!;
      expect(caoCao.hand.length).toBe(2);
      expect(result.state.deck.length).toBe(deckSize - 2);
    });

    it('牌堆不足时失败', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.deck = [];

      const result = playDrawTwo(game, '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('playDuel', () => {
    it('应该对目标造成1点伤害', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = playDuel(game, '曹操', '刘备');
      expect(result.success).toBe(true);
      const liuBei = result.state.players.find(p => p.name === '刘备')!;
      expect(liuBei.health).toBe(3);
    });

    it('不能对自己使用', () => {
      const game = createGame([曹操, 刘备]);
      const result = playDuel(game, '曹操', '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('playArrowBarrage', () => {
    it('应该对所有其他存活玩家造成1点伤害', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = playArrowBarrage(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.state.players.find(p => p.name === '曹操')!;
      const liuBei = result.state.players.find(p => p.name === '刘备')!;
      expect(caoCao.health).toBe(4); // 使用者不受伤害
      expect(liuBei.health).toBe(3); // 目标受伤
    });
  });

  describe('playBarbarianInvasion', () => {
    it('应该对所有其他存活玩家造成1点伤害', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const result = playBarbarianInvasion(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.state.players.find(p => p.name === '曹操')!;
      const liuBei = result.state.players.find(p => p.name === '刘备')!;
      expect(caoCao.health).toBe(4);
      expect(liuBei.health).toBe(3);
    });
  });

  describe('playPeachGarden', () => {
    it('应该恢复所有存活玩家1点体力', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.players[0].health = 3;
      game.players[1].health = 2;

      const result = playPeachGarden(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.state.players.find(p => p.name === '曹操')!;
      const liuBei = result.state.players.find(p => p.name === '刘备')!;
      expect(caoCao.health).toBe(4);
      expect(liuBei.health).toBe(3);
    });

    it('不能超过体力上限', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      // 两人体力都已满

      const result = playPeachGarden(game, '曹操');
      expect(result.success).toBe(false);
    });
  });

  describe('playAbundance', () => {
    it('应该让每名存活玩家摸1张牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      const deckSize = game.deck.length;

      const result = playAbundance(game, '曹操');
      expect(result.success).toBe(true);
      const caoCao = result.state.players.find(p => p.name === '曹操')!;
      const liuBei = result.state.players.find(p => p.name === '刘备')!;
      expect(caoCao.hand.length).toBe(1);
      expect(liuBei.hand.length).toBe(1);
      expect(result.state.deck.length).toBe(deckSize - 2);
    });

    it('牌堆不足时失败', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.deck = [{ id: '杀-♠-3', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '3', description: '' }];

      const result = playAbundance(game, '曹操');
      expect(result.success).toBe(false);
    });
  });
});
