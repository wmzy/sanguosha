import { describe, it, expect } from 'vitest';
import { InterruptStack } from '@engine/interrupt';
import { checkDying, getDyingOptions, applyDying, applyPeachSave } from '@engine/dying';
import { createGame, startGame } from '@engine/state';
import { 曹操, 刘备, 孙权, 诸葛亮, 司马懿 } from '@shared/characters';

describe('杀→闪→dying 完整流程', () => {
  function createTestGame() {
    const game = createGame([曹操, 刘备, 孙权, 诸葛亮, 司马懿], 12345);
    return startGame(game);
  }

  it('杀被闪避后不扣血', async () => {
    const stack = new InterruptStack();
    const game = createTestGame();

    const promise = stack.wait<boolean>('kill_response', {
      attacker: '曹操',
      target: '刘备',
    });

    // Target plays 闪
    stack.resolve(true);

    const dodged = await promise;
    expect(dodged).toBe(true);
    expect(game.players[1].health).toBe(4);
  });

  it('杀命中后触发濒死', async () => {
    const stack = new InterruptStack();
    const game = createTestGame();
    game.players[1].health = 1;
    game.players[1].hand = [];

    // 杀 → no dodge
    const dodgePromise = stack.wait<boolean>('kill_response', {
      attacker: '曹操',
      target: '刘备',
    });
    stack.resolve(false);
    const dodged = await dodgePromise;
    expect(dodged).toBe(false);

    // Check dying
    expect(checkDying(0)).toBe(true);
    const options = getDyingOptions(game, '刘备');
    expect(options.savers).toEqual([]);

    // Apply death
    const deadGame = applyDying(game, '刘备');
    expect(deadGame.players[1].alive).toBe(false);
  });

  it('濒死后可用桃自救', async () => {
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

  it('濒死后队友可用桃救援', async () => {
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
