import { describe, it, expect } from 'vitest';
import { nextPhase, drawPhase, checkDiscard } from '@engine/turn';
import { createGame } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';

describe('回合阶段', () => {
  describe('阶段流转', () => {
    it('应该按顺序进入下一阶段', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';

      const phaseOrder = ['准备', '判定', '摸牌', '出牌', '弃牌', '结束'];
      let currentGame = game;

      for (const expectedPhase of phaseOrder) {
        expect(currentGame.phase).toBe(expectedPhase);
        currentGame = nextPhase(currentGame);
      }
      // 结束阶段后应回到准备阶段，回合数+1
      expect(currentGame.phase).toBe('准备');
      expect(currentGame.round).toBe(2);
    });

    it('结束阶段后应切换到下一个玩家', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.phase = '结束';

      const firstPlayer = game.currentPlayer;
      const nextRound = nextPhase(game);
      // 应该切换到另一个玩家
      expect(nextRound.currentPlayer).not.toBe(firstPlayer);
    });
  });

  describe('摸牌阶段', () => {
    it('应该摸2张牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.phase = '摸牌';

      const currentName = game.currentPlayer;
      const rng = { next: () => Math.random(), nextInt: (max: number) => Math.floor(Math.random() * max) };
      const result = drawPhase(game, rng);
      const currentPlayer = result.state.players.find(p => p.name === currentName)!;
      expect(currentPlayer.hand.length).toBe(2);
      expect(result.state.deck.length).toBe(game.deck.length - 2);
    });
  });

  describe('弃牌阶段', () => {
    it('手牌超过上限时需要弃牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.phase = '弃牌';
      // 给当前玩家5张手牌（体力上限4，需弃1张）
      const currentIdx = game.players.findIndex(p => p.name === game.currentPlayer);
      game.players[currentIdx].hand = game.deck.slice(0, 5);
      game.deck = game.deck.slice(5);

      const needsDiscard = checkDiscard(game);
      expect(needsDiscard).toBe(true);
    });

    it('手牌不超过上限时不需要弃牌', () => {
      const game = createGame([曹操, 刘备]);
      game.status = '进行中';
      game.phase = '弃牌';
      // 给曹操3张手牌（体力上限4，不需要弃）
      game.players[0].hand = game.deck.slice(0, 3);
      game.deck = game.deck.slice(3);

      const needsDiscard = checkDiscard(game);
      expect(needsDiscard).toBe(false);
    });
  });
});
