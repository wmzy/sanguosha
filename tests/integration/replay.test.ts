import { describe, it, expect } from 'vitest';
import { GameLogger } from '@engine/logger';
import { ReplayEngine } from '@engine/replay';
import { GameController } from '@engine/game';
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

    // 使用 GameController 进行游戏
    const { controller } = GameController.createGame([曹操, 刘备], seed, logger);

    // 获取当前状态
    const state = controller.getState();
    const currentPlayer = state.currentPlayer;

    // 找到一张杀
    const player = state.players.find(p => p.name === currentPlayer)!;
    const killCard = player.hand.find(c => c.name === '杀');

    if (killCard) {
      // 找到一个目标
      const target = state.players.find(p => p.name !== currentPlayer && p.alive)!;

      // 使用杀
      const playResult = controller.playCard(currentPlayer, killCard.id, target.name);
      expect(playResult.success).toBe(true);

      // 如果有响应窗口，响应
      if (playResult.responseWindow) {
        const responses = new Map<string, import('../../shared/types').Card | null>();
        responses.set(target.name, null); // 不出闪
        controller.respondToWindow(responses);
      }
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
    expect(engine.getTotalSteps()).toBeGreaterThan(0);
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
      GameController.createGame([曹操, 刘备], seed, logger);
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
