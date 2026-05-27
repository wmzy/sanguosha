import { describe, it, expect } from 'vitest';
import { GameLogger } from '@engine/logger';

describe('GameLogger', () => {
  const meta = {
    version: '1.0.0',
    createdAt: Date.now(),
    playerCount: 2,
    characters: ['曹操', '刘备'],
    seed: 12345,
  };

  it('应该记录服务端操作', () => {
    const logger = new GameLogger(meta);
    logger.logServerOp('gameStart', { players: [] }, '游戏开始');
    const log = logger.export();
    expect(log.serverOps.length).toBe(1);
    expect(log.serverOps[0].type).toBe('gameStart');
    expect(log.serverOps[0].seq).toBe(0);
  });

  it('应该记录玩家操作', () => {
    const logger = new GameLogger(meta);
    logger.logPlayerOp('曹操', 'draw', { cards: [] }, '曹操摸了2张牌');
    logger.logPlayerOp('刘备', 'draw', { cards: [] }, '刘备摸了2张牌');
    const log = logger.export();
    expect(log.playerOps['曹操'].length).toBe(1);
    expect(log.playerOps['刘备'].length).toBe(1);
  });

  it('操作序号应该递增', () => {
    const logger = new GameLogger(meta);
    logger.logServerOp('gameStart', {}, '游戏开始');
    logger.logServerOp('shuffle', {}, '洗牌');
    logger.logServerOp('draw', {}, '摸牌');
    const log = logger.export();
    expect(log.serverOps[0].seq).toBe(0);
    expect(log.serverOps[1].seq).toBe(1);
    expect(log.serverOps[2].seq).toBe(2);
  });

  it('应该包含元数据', () => {
    const logger = new GameLogger(meta);
    const log = logger.export();
    expect(log.meta.version).toBe('1.0.0');
    expect(log.meta.seed).toBe(12345);
    expect(log.meta.characters).toEqual(['曹操', '刘备']);
  });

  it('应该能导入导出', () => {
    const logger = new GameLogger(meta);
    logger.logServerOp('gameStart', { test: true }, '测试');
    const exported = logger.export();
    const json = JSON.stringify(exported);
    const imported = GameLogger.import(JSON.parse(json));
    expect(imported.serverOps.length).toBe(1);
    expect(imported.meta.seed).toBe(12345);
  });
});
