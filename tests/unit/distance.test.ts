import { describe, it, expect } from 'vitest';
import { getDistance, getAttackRange, isInAttackRange } from '@engine/core/distance';
import { createGame, startGame } from '@engine/state';
import { 曹操, 刘备, 孙权, 诸葛亮, 司马懿 } from '@shared/characters';

describe('distance', () => {
  function createTestGame() {
    const game = createGame([曹操, 刘备, 孙权, 诸葛亮, 司马懿], 12345);
    return startGame(game);
  }

  it('adjacent players have distance 1', () => {
    const game = createTestGame();
    expect(getDistance(game, '曹操', '刘备')).toBe(1);
    expect(getDistance(game, '刘备', '曹操')).toBe(1);
  });

  it('distance wraps around', () => {
    const game = createTestGame();
    expect(getDistance(game, '曹操', '司马懿')).toBe(1);
  });

  it('distance is symmetric minimum', () => {
    const game = createTestGame();
    expect(getDistance(game, '曹操', '孙权')).toBe(2);
    expect(getDistance(game, '孙权', '曹操')).toBe(2);
  });

  it('default attack range is 1', () => {
    const game = createTestGame();
    const player = game.players[0];
    expect(getAttackRange(player)).toBe(1);
  });

  it('weapon extends attack range', () => {
    const game = createTestGame();
    const player = {
      ...game.players[0],
      equipment: {
        weapon: { name: '青龙偃月刀', type: '装备牌' as const, subtype: '武器' as const, suit: '♠' as const, rank: '5' as const, description: '', range: 3 },
      },
    };
    expect(getAttackRange(player)).toBe(3);
  });

  it('+1 horse increases distance to player', () => {
    const game = createTestGame();
    game.players[1].equipment.horsePlus = { name: '的卢', type: '装备牌' as const, subtype: '防御马' as const, suit: '♠' as const, rank: 'K' as const, description: '' };
    expect(getDistance(game, '曹操', '刘备')).toBe(2);
  });

  it('isInAttackRange checks distance vs range', () => {
    const game = createTestGame();
    expect(isInAttackRange(game, '曹操', '刘备')).toBe(true);
    expect(isInAttackRange(game, '曹操', '孙权')).toBe(false);
  });
});
