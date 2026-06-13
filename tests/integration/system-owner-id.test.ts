// tests/integration/system-owner-id.test.ts
// 验证开局 skill 注册到保留字 ownerId '系统',而非旧占位 '主公'
import { describe, it, expect } from 'vitest';
import { create, bootstrap, resetForTest } from '../../src/engine/create-engine';
import type { GameConfig } from '../../src/engine/create-engine';
import { findActionEntry } from '../../src/engine/skill';

describe('system ownerId 约定', () => {
  it('开局 skill 应注册到 ownerId "系统"', async () => {
    resetForTest();
    const config: GameConfig = {
      characters: [
        { name: '刘备', skills: ['仁德'] },
        { name: '曹操', skills: ['护甲'] },
        { name: '孙权', skills: ['制衡'] },
      ],
      playerCount: 3,
      seed: 42,
      gameId: 'test-system-owner',
    };
    const state = create(config);
    await bootstrap(state);
    const entry = findActionEntry('开局', '系统', 'start');
    expect(entry).toBeDefined();
  });

  it('旧占位 ownerId "主公" 不应再被使用', async () => {
    resetForTest();
    const config: GameConfig = {
      characters: [
        { name: '刘备', skills: ['仁德'] },
        { name: '曹操', skills: ['护甲'] },
        { name: '孙权', skills: ['制衡'] },
      ],
      playerCount: 3,
      seed: 42,
      gameId: 'test-system-owner-old',
    };
    const state = create(config);
    await bootstrap(state);
    const oldEntry = findActionEntry('开局', '主公', 'start');
    expect(oldEntry).toBeUndefined();
  });
});
