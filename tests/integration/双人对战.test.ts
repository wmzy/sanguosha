// tests/integration/双人对战.test.ts
import { describe, it, expect } from 'vitest';
import { createGame, startGame } from '@engine/state';
import { nextPhase, drawPhase, checkDiscard, executeDiscard } from '@engine/turn';
import { playKill, playPeach } from '@engine/effect';
import { 曹操, 刘备 } from '@shared/characters';

describe('双人对战', () => {
  it('应该能完成一局完整的2人游戏流程', () => {
    // 创建游戏
    let game = createGame([曹操, 刘备]);
    game = startGame(game);

    expect(game.status).toBe('进行中');
    expect(game.players.length).toBe(2);
    expect(game.currentPlayer).toBe('曹操');

    // 第一回合: 准备阶段
    expect(game.phase).toBe('准备');
    game = nextPhase(game);

    // 判定阶段
    expect(game.phase).toBe('判定');
    game = nextPhase(game);

    // 摸牌阶段
    expect(game.phase).toBe('摸牌');
    const drawResult = drawPhase(game);
    game = drawResult.status;
    expect(game.players[0].hand.length).toBe(2);

    // 出牌阶段 - 使用杀
    game = nextPhase(game);
    expect(game.phase).toBe('出牌');

    // 找到一张杀
    const killCard = game.players[0].hand.find(c => c.name === '杀');
    if (killCard) {
      const killResult = playKill(game, '曹操', '刘备');
      expect(killResult.success).toBe(true);
      game = killResult.status;
      expect(game.players[1].health).toBe(3);
    }

    // 弃牌阶段
    game = nextPhase(game);
    expect(game.phase).toBe('弃牌');
    const needsDiscard = checkDiscard(game);
    if (needsDiscard) {
      game = executeDiscard(game, [0]); // 弃第一张牌
    }

    // 结束阶段
    game = nextPhase(game);
    expect(game.phase).toBe('结束');

    // 进入下一回合 (刘备的回合)
    game = nextPhase(game);
    expect(game.phase).toBe('准备');
    expect(game.currentPlayer).toBe('刘备');
    expect(game.round).toBe(2);
  });

  it('应该正确处理伤害和死亡', () => {
    const game = createGame([曹操, 刘备]);
    game.status = '进行中';

    // 对刘备造成4点伤害 (致命)
    let currentGame = game;
    for (let i = 0; i < 4; i++) {
      const result = playKill(currentGame, '曹操', '刘备');
      currentGame = result.status;
    }

    const liuBei = currentGame.players.find(p => p.name === '刘备')!;
    expect(liuBei.health).toBe(0);
  });

  it('应该正确使用桃恢复体力', () => {
    const game = createGame([曹操, 刘备]);
    game.status = '进行中';
    game.currentPlayer = '曹操';

    // 先受伤
    const damageResult = playKill(game, '曹操', '刘备');
    expect(damageResult.status.players[1].health).toBe(3);

    // 给刘备一张桃 (注: 使用桃仅检查体力上限，不检查手牌)
    const damagedGame = damageResult.status;
    damagedGame.players[1].hand = [{ name: '桃', type: '基本牌', subtype: '桃', suit: '♥', rank: '7', description: '' }];

    // 刘备使用桃
    const peachResult = playPeach(damagedGame, '刘备');
    expect(peachResult.success).toBe(true);
    expect(peachResult.status.players[1].health).toBe(4);
  });
});
