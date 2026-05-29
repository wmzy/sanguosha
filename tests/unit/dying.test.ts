import { describe, it, expect } from 'vitest';
import { checkDying, getDyingOptions, applyDying, applyPeachSave } from '@engine/dying';
import { createGame, startGame } from '@engine/state';
import { 曹操, 刘备, 孙权, 诸葛亮, 司马懿 } from '@shared/characters';

describe('dying', () => {
  function createTestGame() {
    const game = createGame([曹操, 刘备, 孙权, 诸葛亮, 司马懿], 12345);
    return startGame(game);
  }

  describe('checkDying', () => {
    it('health <= 0 is dying', () => {
      expect(checkDying(0)).toBe(true);
      expect(checkDying(-1)).toBe(true);
    });
    it('health > 0 is not dying', () => {
      expect(checkDying(1)).toBe(false);
      expect(checkDying(4)).toBe(false);
    });
  });

  describe('getDyingOptions', () => {
    it('player with 桃 can self-save', () => {
      const game = createTestGame();
      game.players[1].hand = [{ id: '桃-♥-7', name: '桃', type: '基本牌', subtype: '桃', suit: '♥', rank: '7', description: '' }];
      const options = getDyingOptions(game, '刘备');
      expect(options.canSelfSave).toBe(true);
      expect(options.savers).toContain('刘备');
    });

    it('player without 桃 cannot self-save', () => {
      const game = createTestGame();
      game.players[1].hand = [];
      const options = getDyingOptions(game, '刘备');
      expect(options.canSelfSave).toBe(false);
    });

    it('other players with 桃 can save', () => {
      const game = createTestGame();
      game.players[1].hand = [];
      game.players[0].hand = [{ id: '桃-♥-7', name: '桃', type: '基本牌', subtype: '桃', suit: '♥', rank: '7', description: '' }];
      const options = getDyingOptions(game, '刘备');
      expect(options.savers).toContain('曹操');
    });

    it('no one can save returns empty savers', () => {
      const game = createTestGame();
      for (const p of game.players) p.hand = [];
      const options = getDyingOptions(game, '刘备');
      expect(options.savers).toEqual([]);
    });
  });

  describe('applyDying', () => {
    it('marks player as dead with 0 health', () => {
      const game = createTestGame();
      const result = applyDying(game, '刘备');
      const liubei = result.players.find(p => p.name === '刘备')!;
      expect(liubei.alive).toBe(false);
      expect(liubei.health).toBe(0);
    });
  });

  describe('applyPeachSave', () => {
    it('self-save restores health and removes peach', () => {
      const game = createTestGame();
      game.players[1].health = 0;
      game.players[1].hand = [{ id: '桃-♥-7', name: '桃', type: '基本牌', subtype: '桃', suit: '♥', rank: '7', description: '' }];
      const result = applyPeachSave(game, '刘备', '刘备');
      expect(result.players[1].health).toBe(1);
      expect(result.players[1].alive).toBe(true);
      expect(result.players[1].hand.length).toBe(0);
    });

    it('teammate save restores dying player health and removes peach from saver', () => {
      const game = createTestGame();
      game.players[1].health = 0;
      game.players[0].hand = [{ id: '桃-♥-7', name: '桃', type: '基本牌', subtype: '桃', suit: '♥', rank: '7', description: '' }];
      const result = applyPeachSave(game, '曹操', '刘备');
      expect(result.players[1].health).toBe(1);
      expect(result.players[1].alive).toBe(true);
      expect(result.players[0].hand.length).toBe(0);
    });
  });
});
