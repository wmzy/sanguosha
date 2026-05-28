import { describe, it, expect } from 'vitest';
import { GameLogger } from '@engine/logger';
import { ReplayEngine } from '@engine/replay';
import { createGame, startGame } from '@engine/state';
import { nextPhase, drawPhase } from '@engine/turn';
import { useKill } from '@engine/effect';
import { 曹操, 刘备 } from '@shared/characters';

describe('完整重播流程', () => {
  it('完整游戏 → 导出日志 → 导入 → 重播 → 验证状态一致', () => {
    const seed = 12345;
    const logger = new GameLogger({
      version: '1.0.0',
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['曹操', '刘备'],
      seed,
    });

    // 进行一局游戏
    let game = createGame([曹操, 刘备], seed, logger);
    game = startGame(game);
    game = nextPhase(game, logger); // 准备 → 判定
    game = nextPhase(game, logger); // 判定 → 摸牌
    const drawResult = drawPhase(game, logger);
    game = drawResult.status;
    game = nextPhase(game, logger); // 摸牌 → 出牌

    // 使用杀
    const killResult = useKill(game, '曹操', '刘备', logger);
    expect(killResult.success).toBe(true);

    // 导出日志
    const log = logger.export();

    // 验证日志内容
    expect(log.serverOps.length).toBeGreaterThan(0);
    expect(log.meta.seed).toBe(seed);

    // 导入并重播
    const json = JSON.stringify(log);
    const imported = GameLogger.import(JSON.parse(json));
    const engine = ReplayEngine.create(imported);

    // 验证重播状态
    expect(engine.getTotalSteps()).toBe(log.serverOps.length + 1);
    engine.goTo(engine.getTotalSteps() - 1);
    const finalState = engine.getCurrentState();
    expect(finalState.players.find(p => p.name === '刘备')!.health).toBe(3);
  });

  it('相同种子的重播结果应该相同', () => {
    const seed = 99999;

    function runGame() {
      const logger = new GameLogger({
        version: '1.0.0',
        createdAt: Date.now(),
        playerCount: 2,
        characters: ['曹操', '刘备'],
        seed,
      });
      let game = createGame([曹操, 刘备], seed, logger);
      game = startGame(game);
      game = nextPhase(game, logger);
      game = nextPhase(game, logger);
      const drawResult = drawPhase(game, logger);
      void drawResult;
      return logger.export();
    }

    const log1 = runGame();
    const log2 = runGame();

    const engine1 = ReplayEngine.create(log1);
    const engine2 = ReplayEngine.create(log2);

    for (let i = 0; i < engine1.getTotalSteps(); i++) {
      engine1.goTo(i);
      engine2.goTo(i);
      const s1 = engine1.getCurrentState();
      const s2 = engine2.getCurrentState();
      expect(s1.phase).toBe(s2.phase);
      expect(s1.currentPlayer).toBe(s2.currentPlayer);
    }
  });
});
