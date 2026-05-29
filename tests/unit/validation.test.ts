import { describe, it, expect } from 'vitest';
import { ValidationPipeline, phaseValidator, targetValidator } from '@engine/core/validation';
import { createGame, startGame } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';
import type { PlayerAction } from '@shared/types';

describe('ValidationPipeline', () => {
  function createTestGame() {
    const game = createGame([曹操, 刘备], 12345);
    return startGame(game);
  }

  it('phaseValidator blocks actions in wrong phase', () => {
    const game = createTestGame();
    game.phase = '摸牌';
    const action: PlayerAction = { type: '出牌', card: game.players[0].hand[0] };
    const result = phaseValidator({ game, player: '曹操', action, phase: game.phase });
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
  });

  it('phaseValidator allows actions in correct phase', () => {
    const game = createTestGame();
    game.phase = '出牌';
    const action: PlayerAction = { type: '出牌', card: game.players[0].hand[0] };
    const result = phaseValidator({ game, player: '曹操', action, phase: game.phase });
    expect(result).toBeNull();
  });

  it('targetValidator blocks self-target for 杀', () => {
    const game = createTestGame();
    const action: PlayerAction = {
      type: '出牌',
      card: { name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '3', description: '' },
      target: '曹操',
    };
    const result = targetValidator({ game, player: '曹操', action, phase: '出牌' });
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
  });

  it('targetValidator allows valid target', () => {
    const game = createTestGame();
    const action: PlayerAction = {
      type: '出牌',
      card: { name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '3', description: '' },
      target: '刘备',
    };
    const result = targetValidator({ game, player: '曹操', action, phase: '出牌' });
    expect(result).toBeNull();
  });

  it('pipeline runs all validators', () => {
    const pipeline = new ValidationPipeline();
    pipeline.addValidator(phaseValidator);
    pipeline.addValidator(targetValidator);

    const game = createTestGame();
    game.phase = '摸牌';
    const action: PlayerAction = { type: '出牌', card: game.players[0].hand[0] };
    const result = pipeline.validate({ game, player: '曹操', action, phase: game.phase });
    expect(result.valid).toBe(false);
  });
});
