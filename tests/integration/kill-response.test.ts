import { describe, it, expect } from 'vitest';
import type { Card, Player, GameState } from '@shared/types';
import { createKillResponseWindow, resolveKillResponse } from '@engine/response';
import { checkDying, getDyingOptions, applyDying, applyPeachSave } from '@engine/dying';
import { createGame, startGame } from '@engine/state';
import { 曹操, 刘备, 孙权, 诸葛亮, 司马懿 } from '@shared/characters';

function makeCard(name: string, overrides?: Partial<Card>): Card {
  return {
    name,
    type: '基本牌',
    subtype: name === '闪' ? '闪' : name === '桃' ? '桃' : '杀',
    suit: '♠',
    rank: 'A',
    description: '',
    id: `${name}-test-♠-A`,
    ...overrides,
  };
}

describe('杀→闪→dying 完整流程', () => {
  function createTestGame() {
    const game = createGame([曹操, 刘备, 孙权, 诸葛亮, 司马懿], 12345);
    return startGame(game);
  }

  it('杀被闪避后不扣血', () => {
    const game = createTestGame();
    const dodgeCard = makeCard('闪');
    game.players[1].hand = [dodgeCard, ...game.players[1].hand];

    const killCard = makeCard('杀');
    const window = createKillResponseWindow('曹操', '刘备', killCard);

    const responses = new Map<string, Card | null>();
    responses.set('刘备', dodgeCard);
    const result = resolveKillResponse(game, window, responses);

    expect(result.players[1].health).toBe(4);
  });

  it('杀命中后扣血并触发濒死', () => {
    const game = createTestGame();
    game.players[1].health = 1;
    game.players[1].hand = [];

    const killCard = { id: '杀-♠-3', name: '杀', type: '基本牌' as const, subtype: '杀' as const, suit: '♠' as const, rank: '3' as const, description: '' };
    const window = createKillResponseWindow('曹操', '刘备', killCard);

    const responses = new Map<string, null>();
    responses.set('刘备', null);
    const result = resolveKillResponse(game, window, responses);

    expect(result.players[1].health).toBe(0);

    expect(checkDying(0)).toBe(true);
    const options = getDyingOptions(result, '刘备');
    expect(options.savers).toEqual([]);

    const deadGame = applyDying(result, '刘备');
    expect(deadGame.players[1].alive).toBe(false);
  });

  it('濒死后可用桃自救', () => {
    const game = createTestGame();
    game.players[1].health = 1;
    game.players[1].hand = [{ id: '桃-♥-7', name: '桃', type: '基本牌', subtype: '桃', suit: '♥', rank: '7', description: '' }];

    expect(checkDying(0)).toBe(true);
    const options = getDyingOptions(game, '刘备');
    expect(options.canSelfSave).toBe(true);

    const savedGame = applyPeachSave(game, '刘备', '刘备');
    expect(savedGame.players[1].health).toBe(1);
    expect(savedGame.players[1].alive).toBe(true);
    expect(savedGame.players[1].hand.length).toBe(0);
  });

  it('濒死后队友可用桃救援', () => {
    const game = createTestGame();
    game.players[1].health = 1;
    game.players[1].hand = [];
    game.players[0].hand = [{ id: '桃-♥-7', name: '桃', type: '基本牌', subtype: '桃', suit: '♥', rank: '7', description: '' }];

    expect(checkDying(0)).toBe(true);
    const options = getDyingOptions(game, '刘备');
    expect(options.savers).toContain('曹操');

    const savedGame = applyPeachSave(game, '曹操', '刘备');
    expect(savedGame.players[1].health).toBe(1);
    expect(savedGame.players[1].alive).toBe(true);
    expect(savedGame.players[0].hand.length).toBe(0);
  });
});
