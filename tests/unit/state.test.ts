// tests/unit/state.test.ts
import { describe, it, expect } from 'vitest';
import { createGame, getPublicState } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';

describe('游戏状态', () => {
  describe('创建游戏', () => {
    it('应该创建指定玩家数的游戏', () => {
      const game = createGame([曹操, 刘备]);
      expect(game.players.length).toBe(2);
      expect(game.status).toBe('等待中');
    });

    it('应该为每个玩家设置正确的初始状态', () => {
      const game = createGame([曹操, 刘备]);
      const player1 = game.players[0];
      expect(player1.character.name).toBe('曹操');
      expect(player1.health).toBe(4);
      expect(player1.maxHealth).toBe(4);
      expect(player1.alive).toBe(true);
      expect(player1.hand.length).toBe(0);
    });

    it('应该创建洗好的牌堆', () => {
      const game = createGame([曹操, 刘备]);
      expect(game.deck.length).toBeGreaterThan(0);
      expect(game.discardPile.length).toBe(0);
    });
  });

  describe('获取公开状态', () => {
    it('应该隐藏其他玩家的手牌', () => {
      const game = createGame([曹操, 刘备]);
      // 给玩家一些手牌
      game.players[0].hand = [game.deck[0], game.deck[1]];

      const publicState = getPublicState(game, '曹操');
      const caoCaoPublic = publicState.players.find(p => p.character.name === '曹操')!;
      const liuBeiPublic = publicState.players.find(p => p.character.name === '刘备')!;

      // 曹操能看到自己的手牌
      expect(caoCaoPublic.hand).toBeDefined();
      expect(caoCaoPublic.hand!.length).toBe(2);

      // 刘备不能看到曹操的手牌
      expect(liuBeiPublic.hand).toBeUndefined();
      expect(liuBeiPublic.handCount).toBe(0);
    });
  });
});
