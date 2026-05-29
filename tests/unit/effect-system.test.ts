import { describe, it, expect } from 'vitest';
import { executeEffect } from '@engine/core/effect';
import { createGame, startGame } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';
import type { Effect, EffectContext } from '@shared/types';

describe('executeEffect', () => {
  function createTestGame() {
    const game = createGame([曹操, 刘备], 12345);
    return startGame(game);
  }

  it('draw effect draws cards', () => {
    const game = createTestGame();
    const effect: Effect = { type: 'draw', count: 2 };
    const ctx: EffectContext = { player: '曹操' };
    const result = executeEffect(game, effect, ctx);
    const caocao = result.players.find(p => p.name === '曹操')!;
    expect(caocao.hand.length).toBe(6); // 4 initial + 2 drawn
  });

  it('damage effect reduces health', () => {
    const game = createTestGame();
    const effect: Effect = { type: 'damage', amount: 1 };
    const ctx: EffectContext = { player: '曹操', target: '刘备' };
    const result = executeEffect(game, effect, ctx);
    const liubei = result.players.find(p => p.name === '刘备')!;
    expect(liubei.health).toBe(3);
  });

  it('heal effect restores health', () => {
    const game = createTestGame();
    game.players[1].health = 2;
    const effect: Effect = { type: 'heal', amount: 1 };
    const ctx: EffectContext = { player: '刘备' };
    const result = executeEffect(game, effect, ctx);
    const liubei = result.players.find(p => p.name === '刘备')!;
    expect(liubei.health).toBe(3);
  });

  it('heal cannot exceed maxHealth', () => {
    const game = createTestGame();
    const effect: Effect = { type: 'heal', amount: 5 };
    const ctx: EffectContext = { player: '曹操' };
    const result = executeEffect(game, effect, ctx);
    const caocao = result.players.find(p => p.name === '曹操')!;
    expect(caocao.health).toBe(caocao.maxHealth);
  });

  it('sequence effect executes steps in order', () => {
    const game = createTestGame();
    const effect: Effect = {
      type: 'sequence',
      steps: [
        { type: 'damage', amount: 1 },
        { type: 'heal', amount: 1 },
      ],
    };
    const ctx: EffectContext = { player: '曹操', target: '刘备' };
    const result = executeEffect(game, effect, ctx);
    const liubei = result.players.find(p => p.name === '刘备')!;
    expect(liubei.health).toBe(4);
  });

  it('conditional effect branches correctly', () => {
    const game = createTestGame();
    game.players[1].health = 2;
    const effect: Effect = {
      type: 'conditional',
      condition: { hasHandCards: true },
      then: { type: 'heal', amount: 1 },
      else: { type: 'draw', count: 1 },
    };
    const ctx: EffectContext = { player: '刘备' };
    const result = executeEffect(game, effect, ctx);
    const liubei = result.players.find(p => p.name === '刘备')!;
    expect(liubei.health).toBe(3);
  });
});
