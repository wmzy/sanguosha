import { describe, it, expect } from 'vitest';
import { isCardPlayable, getValidTargetsForCard, canEndTurn, validateAction, getValidActions } from '@engine/rules';
import { createGame, startGame } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';
import type { Card } from '@shared/types';

const 杀: Card = { id: '杀-♠-3', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '3', description: '' };
const 闪: Card = { id: '闪-♥-5', name: '闪', type: '基本牌', subtype: '闪', suit: '♥', rank: '5', description: '' };
const 桃: Card = { id: '桃-♥-7', name: '桃', type: '基本牌', subtype: '桃', suit: '♥', rank: '7', description: '' };
const 过河拆桥: Card = { id: '过河拆桥-♠-3', name: '过河拆桥', type: '锦囊牌', subtype: '锦囊', suit: '♠', rank: '3', description: '' };
const 武器: Card = { id: '诸葛连弩-♠-A', name: '诸葛连弩', type: '装备牌', subtype: '武器', suit: '♠', rank: 'A', description: '', range: 1 };

function createTestGame() {
  const game = createGame([曹操, 刘备], 12345);
  const started = startGame(game);
  // 手动设置为出牌阶段
  return {
    ...started,
    phase: '出牌',
    currentPlayer: '曹操',
  } as typeof started;
}

describe('rules', () => {
  describe('isCardPlayable', () => {
    it('杀在有目标时可出', () => {
      const game = createTestGame();
      const player = game.players[0];
      expect(isCardPlayable(game, player, 杀)).toBe(true);
    });

    it('闪不能主动出', () => {
      const game = createTestGame();
      const player = game.players[0];
      expect(isCardPlayable(game, player, 闪)).toBe(false);
    });

    it('桃满血时不能出', () => {
      const game = createTestGame();
      const player = game.players[0]; // 满血
      expect(isCardPlayable(game, player, 桃)).toBe(false);
    });

    it('桃非满血时可出', () => {
      const game = createTestGame();
      game.players[0].health = 3;
      const player = game.players[0];
      expect(isCardPlayable(game, player, 桃)).toBe(true);
    });

    it('装备牌可出', () => {
      const game = createTestGame();
      const player = game.players[0];
      expect(isCardPlayable(game, player, 武器)).toBe(true);
    });

    it('不是自己的回合时不能出', () => {
      const game = createTestGame();
      const player = game.players[1]; // 刘备，不是当前玩家
      expect(isCardPlayable(game, player, 杀)).toBe(false);
    });

    it('不是出牌阶段时不能出', () => {
      const game = createTestGame();
      game.phase = '摸牌';
      const player = game.players[0];
      expect(isCardPlayable(game, player, 杀)).toBe(false);
    });
  });

  describe('getValidTargetsForCard', () => {
    it('杀可以指向所有存活的其他玩家', () => {
      const game = createTestGame();
      const player = game.players[0];
      const targets = getValidTargetsForCard(game, player, 杀);
      expect(targets).toEqual(['刘备']);
    });

    it('过河拆桥只能指向有手牌的玩家', () => {
      const game = createTestGame();
      game.players[1].hand = []; // 刘备没手牌
      const player = game.players[0];
      const targets = getValidTargetsForCard(game, player, 过河拆桥);
      expect(targets).toEqual([]);
    });

    it('无目标的牌返回空数组', () => {
      const game = createTestGame();
      const player = game.players[0];
      const targets = getValidTargetsForCard(game, player, 桃);
      expect(targets).toEqual([]);
    });
  });

  describe('canEndTurn', () => {
    it('出牌阶段可以结束回合', () => {
      const game = createTestGame();
      expect(canEndTurn(game, '曹操')).toBe(true);
    });

    it('不是当前玩家不能结束回合', () => {
      const game = createTestGame();
      expect(canEndTurn(game, '刘备')).toBe(false);
    });

    it('不是出牌阶段不能结束回合', () => {
      const game = createTestGame();
      game.phase = '摸牌';
      expect(canEndTurn(game, '曹操')).toBe(false);
    });
  });

  describe('validateAction', () => {
    it('出杀需要目标', () => {
      const game = createTestGame();
      game.players[0].hand = [杀];
      const result = validateAction(game, '曹操', { type: '出牌', card: 杀, target: '刘备' });
      expect(result.valid).toBe(true);
    });

    it('出闪不合法', () => {
      const game = createTestGame();
      game.players[0].hand = [闪];
      const result = validateAction(game, '曹操', { type: '出牌', card: 闪 });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('这张牌不能使用');
    });

    it('结束回合合法', () => {
      const game = createTestGame();
      const result = validateAction(game, '曹操', { type: '结束回合' });
      expect(result.valid).toBe(true);
    });

    it('不是自己的回合不合法', () => {
      const game = createTestGame();
      const result = validateAction(game, '刘备', { type: '结束回合' });
      expect(result.valid).toBe(false);
    });
  });

  describe('getValidActions', () => {
    it('返回当前玩家的所有可用操作', () => {
      const game = createTestGame();
      game.players[0].hand = [杀, 闪, 桃, 武器];

      const actions = getValidActions(game, '曹操');
      // 杀和武器可出，闪和桃（满血）不可出
      expect(actions.playableCardIndices).toContain(0); // 杀
      expect(actions.playableCardIndices).not.toContain(1); // 闪
      expect(actions.playableCardIndices).not.toContain(2); // 桃（满血）
      expect(actions.playableCardIndices).toContain(3); // 武器
      expect(actions.canEndTurn).toBe(true);
    });

    it('返回需要目标的牌的合法目标', () => {
      const game = createTestGame();
      game.players[0].hand = [杀];

      const actions = getValidActions(game, '曹操');
      expect(actions.validTargets.get(0)).toEqual(['刘备']);
    });

    it('不是当前玩家时返回空', () => {
      const game = createTestGame();
      const actions = getValidActions(game, '刘备');
      expect(actions.playableCardIndices).toEqual([]);
      expect(actions.canEndTurn).toBe(false);
    });
  });
});
