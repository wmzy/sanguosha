import { describe, it, expect } from 'vitest';
import { GameLogger } from '@engine/logger';
import { ReplayEngine } from '@engine/replay';
import { 创建游戏, 开始游戏 } from '@engine/状态';
import { 进入下一阶段, 摸牌阶段 } from '@engine/回合';
import { 使用杀 } from '@engine/效果';
import { 曹操, 刘备 } from '@shared/角色';

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
    let 游戏 = 创建游戏([曹操, 刘备], seed, logger);
    游戏 = 开始游戏(游戏);
    游戏 = 进入下一阶段(游戏, logger); // 准备 → 判定
    游戏 = 进入下一阶段(游戏, logger); // 判定 → 摸牌
    const 摸牌结果 = 摸牌阶段(游戏, logger);
    游戏 = 摸牌结果.状态;
    游戏 = 进入下一阶段(游戏, logger); // 摸牌 → 出牌

    // 使用杀
    const 杀结果 = 使用杀(游戏, '曹操', '刘备', logger);
    if (杀结果.成功) {
      游戏 = 杀结果.状态;
    }

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
    expect(finalState.玩家列表.find(p => p.name === '刘备')!.体力).toBe(3);
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
      let 游戏 = 创建游戏([曹操, 刘备], seed, logger);
      游戏 = 开始游戏(游戏);
      游戏 = 进入下一阶段(游戏, logger);
      游戏 = 进入下一阶段(游戏, logger);
      const 摸牌结果 = 摸牌阶段(游戏, logger);
      游戏 = 摸牌结果.状态;
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
      expect(s1.当前阶段).toBe(s2.当前阶段);
      expect(s1.当前玩家).toBe(s2.当前玩家);
    }
  });
});
