// tests/unit/victory.test.ts
import { describe, it, expect } from 'vitest';
import { createGame, checkVictory, playerDeath } from '@engine/state';
import { 曹操, 刘备, 孙权, 吕布, 貂蝉 } from '@shared/characters';
import type { GameState, Role } from '@shared/types';

function setPlayerRoles(game: GameState, roleMap: Record<string, Role>): GameState {
  const newPlayers = game.players.map(p => ({
    ...p,
    role: roleMap[p.name] ?? p.role,
  }));
  return { ...game, players: newPlayers };
}

describe('胜利条件', () => {
  describe('主公获胜', () => {
    it('所有反贼和内奸死亡时，主公获胜', () => {
      let game = createGame([曹操, 刘备, 孙权, 吕布]);
      game = setPlayerRoles(game, { 曹操: '主公', 刘备: '忠臣', 孙权: '反贼', 吕布: '内奸' });

      // 反贼和内奸死亡
      game = playerDeath(game, '孙权');
      game = playerDeath(game, '吕布');

      expect(game.status).toBe('已结束');
      expect(game.winner).toBe('主公');
    });

    it('只剩主公和忠臣时，主公获胜', () => {
      let game = createGame([曹操, 刘备, 孙权]);
      game = setPlayerRoles(game, { 曹操: '主公', 刘备: '忠臣', 孙权: '反贼' });

      // 反贼死亡
      game = playerDeath(game, '孙权');

      expect(game.status).toBe('已结束');
      expect(game.winner).toBe('主公');
    });
  });

  describe('反贼获胜', () => {
    it('主公死亡时，反贼获胜', () => {
      let game = createGame([曹操, 刘备, 孙权]);
      game = setPlayerRoles(game, { 曹操: '主公', 刘备: '反贼', 孙权: '反贼' });

      // 主公死亡
      game = playerDeath(game, '曹操');

      expect(game.status).toBe('已结束');
      expect(game.winner).toBe('反贼');
    });

    it('2人局主公死亡时，反贼获胜', () => {
      let game = createGame([曹操, 刘备]);
      game = setPlayerRoles(game, { 曹操: '主公', 刘备: '反贼' });

      game = playerDeath(game, '曹操');

      expect(game.status).toBe('已结束');
      expect(game.winner).toBe('反贼');
    });
  });

  describe('内奸获胜', () => {
    it('只剩内奸时，内奸获胜', () => {
      let game = createGame([曹操, 刘备, 孙权, 吕布, 貂蝉]);
      game = setPlayerRoles(game, { 曹操: '主公', 刘备: '忠臣', 孙权: '反贼', 吕布: '反贼', 貂蝉: '内奸' });

      // 先杀反贼
      game = playerDeath(game, '孙权');
      game = playerDeath(game, '吕布');
      // 再杀忠臣
      game = playerDeath(game, '刘备');
      // 最后杀主公
      game = playerDeath(game, '曹操');

      expect(game.status).toBe('已结束');
      expect(game.winner).toBe('内奸');
    });
  });

  describe('游戏未结束', () => {
    it('反贼存活时游戏继续', () => {
      let game = createGame([曹操, 刘备, 孙权]);
      game = setPlayerRoles(game, { 曹操: '主公', 刘备: '忠臣', 孙权: '反贼' });

      // 没有人死亡
      game = checkVictory(game);

      expect(game.status).not.toBe('已结束');
      expect(game.winner).toBeUndefined();
    });

    it('内奸存活且主公存活时游戏继续', () => {
      let game = createGame([曹操, 刘备, 孙权, 吕布]);
      game = setPlayerRoles(game, { 曹操: '主公', 刘备: '反贼', 孙权: '反贼', 吕布: '内奸' });

      // 杀一个反贼
      game = playerDeath(game, '刘备');
      // 还有一个反贼存活

      expect(game.status).not.toBe('已结束');
      expect(game.winner).toBeUndefined();
    });
  });

  describe('玩家死亡', () => {
    it('应将玩家标记为死亡', () => {
      let game = createGame([曹操, 刘备, 孙权, 吕布]);
      game = setPlayerRoles(game, { 曹操: '主公', 刘备: '反贼', 孙权: '反贼', 吕布: '内奸' });

      game = playerDeath(game, '刘备');

      const liuBei = game.players.find(p => p.name === '刘备')!;
      expect(liuBei.alive).toBe(false);
    });

    it('不影响其他玩家存活状态', () => {
      let game = createGame([曹操, 刘备, 孙权, 吕布]);
      game = setPlayerRoles(game, { 曹操: '主公', 刘备: '反贼', 孙权: '反贼', 吕布: '内奸' });

      game = playerDeath(game, '刘备');

      const caoCao = game.players.find(p => p.name === '曹操')!;
      expect(caoCao.alive).toBe(true);
    });
  });
});
