import { describe, it, expect } from 'vitest';
import { ReplayEngine } from '@engine/replay';
import { GameLogger } from '@engine/logger';
import { createGame, startGame } from '@engine/state';
import { nextPhase, drawPhase } from '@engine/turn';
import { 曹操, 刘备 } from '@shared/characters';

describe('ReplayEngine', () => {
  function createTestLog() {
    const logger = new GameLogger({
      version: '1.0.0',
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['曹操', '刘备'],
      seed: 12345,
    });

    let game = createGame([曹操, 刘备], 12345, logger);
    game = startGame(game);
    game = nextPhase(game, logger); // 准备 → 判定
    game = nextPhase(game, logger); // 判定 → 摸牌
    const drawResult = drawPhase(game, logger);
    void drawResult;

    return logger.export();
  }

  it('应该能创建重播引擎', () => {
    const log = createTestLog();
    const engine = ReplayEngine.create(log);
    expect(engine.getTotalSteps()).toBeGreaterThan(0);
  });

  it('应该能前进和后退', () => {
    const log = createTestLog();
    const engine = ReplayEngine.create(log);
    const state0 = engine.getCurrentState();
    const state1 = engine.next();
    expect(state1).not.toBe(state0);
    const state0Again = engine.prev();
    expect(state0Again.phase).toBe(state0.phase);
  });

  it('应该能跳转到指定步骤', () => {
    const log = createTestLog();
    const engine = ReplayEngine.create(log);
    engine.goTo(3);
    expect(engine.getCurrentStep()).toBe(3);
  });

  it('应该能获取玩家视角', () => {
    const log = createTestLog();
    const engine = ReplayEngine.create(log);
    engine.goTo(engine.getTotalSteps() - 1);
    const view = engine.getPlayerView('曹操');
    expect(view).toBeDefined();
    expect(view.currentPlayer).toBeDefined();
  });

  it('相同种子的重播结果应该相同', () => {
    const log1 = createTestLog();
    const log2 = createTestLog();
    const engine1 = ReplayEngine.create(log1);
    const engine2 = ReplayEngine.create(log2);
    expect(engine1.getTotalSteps()).toBe(engine2.getTotalSteps());
    for (let i = 0; i < engine1.getTotalSteps(); i++) {
      engine1.goTo(i);
      engine2.goTo(i);
      expect(engine1.getCurrentState().phase).toBe(engine2.getCurrentState().phase);
    }
  });
});
