import { describe, it, expect } from 'vitest';
import { ValidationPipeline } from '@engine/validation';
import { createGame, startGame } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';
import type { PlayerAction, GameState } from '@shared/types';

describe('ValidationPipeline', () => {
  function createTestGame(): GameState {
    const game = createGame([曹操, 刘备], 12345);
    const started = startGame(game);
    return {
      ...started,
      phase: '出牌',
      currentPlayer: '曹操',
    };
  }

  it('blocks card play in wrong phase', () => {
    const game = createTestGame();
    game.phase = '摸牌';
    const pipeline = new ValidationPipeline();
    const action: PlayerAction = { type: '出牌', card: game.players[0].hand[0] };
    const result = pipeline.validateAction(game, '曹操', action);
    expect(result.valid).toBe(false);
  });

  it('allows card play in correct phase', () => {
    const game = createTestGame();
    const pipeline = new ValidationPipeline();
    const action: PlayerAction = { type: '出牌', card: game.players[0].hand[0] };
    const result = pipeline.validateAction(game, '曹操', action);
    expect(result.valid).toBe(true);
  });

  it('blocks end turn for wrong player', () => {
    const game = createTestGame();
    const pipeline = new ValidationPipeline();
    const action: PlayerAction = { type: '结束回合' };
    const result = pipeline.validateAction(game, '刘备', action);
    expect(result.valid).toBe(false);
  });

  it('allows end turn for current player in play phase', () => {
    const game = createTestGame();
    const pipeline = new ValidationPipeline();
    const action: PlayerAction = { type: '结束回合' };
    const result = pipeline.validateAction(game, '曹操', action);
    expect(result.valid).toBe(true);
  });
});
