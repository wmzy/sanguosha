import { describe, it, expect } from 'vitest';
import { ReplayEngine } from '@engine/replay';
import { GameLogger } from '@engine/logger';
import { 创建游戏, 开始游戏 } from '@engine/状态';
import { 进入下一阶段, 摸牌阶段 } from '@engine/回合';
import { 曹操, 刘备 } from '@shared/角色';

describe('ReplayEngine', () => {
  function createTestLog() {
    const logger = new GameLogger({
      version: '1.0.0',
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['曹操', '刘备'],
      seed: 12345,
    });

    let 游戏 = 创建游戏([曹操, 刘备], 12345, logger);
    游戏 = 开始游戏(游戏);
    游戏 = 进入下一阶段(游戏, logger); // 准备 → 判定
    游戏 = 进入下一阶段(游戏, logger); // 判定 → 摸牌
    const 摸牌结果 = 摸牌阶段(游戏, logger);
    void 摸牌结果;

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
    expect(state0Again.当前阶段).toBe(state0.当前阶段);
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
    expect(view.当前玩家).toBeDefined();
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
      expect(engine1.getCurrentState().当前阶段).toBe(engine2.getCurrentState().当前阶段);
    }
  });
});
