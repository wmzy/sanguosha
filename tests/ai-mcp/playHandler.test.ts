// tests/ai-mcp/playHandler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runPlay } from '../../src/ai-mcp/playHandler';
import type { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import type { ClientMessage as EngineClientMessage } from '../../src/engine/types';

// 最小 fake：只暴露 runPlay 需要的方法
function makeFake(overrides: Partial<HeadlessGameClient> = {}): HeadlessGameClient {
  return {
    phase: 'playing',
    needsAction: () => true,
    gameOverWinner: null,
    view: null,
    getAvailableActions: () => [],
    drainNewEvents: () => [],
    sendAction: vi.fn(),
    ...overrides,
  } as unknown as HeadlessGameClient;
}

describe('runPlay', () => {
  it('needsAction 立即为 true 时直接返回当前状态', async () => {
    const fake = makeFake();
    const res = await runPlay(fake, { waitTimeoutMs: 100 });
    expect(res.needsAction).toBe(true);
    expect(res.phase).toBe('playing');
    expect(res.lastActionResult).toBe('not-applicable');
  });

  it('游戏结束时立即返回', async () => {
    const fake = makeFake({ phase: 'ended' as any, gameOverWinner: '主公' } as any);
    const res = await runPlay(fake, { waitTimeoutMs: 100 });
    expect(res.gameOver).toEqual({ winner: '主公' });
  });

  it('执行传入的 action', async () => {
    const fake = makeFake();
    const action: EngineClientMessage = { skillId: '杀', actionType: 'use', ownerId: 0, params: { cardId: 'c1', targets: [1] }, baseSeq: 0 };
    await runPlay(fake, { action: { message: action }, waitTimeoutMs: 100 });
    expect(fake.sendAction).toHaveBeenCalledWith(action);
  });

  it('未轮到自己且超时后返回 needsAction=false', async () => {
    const fake = makeFake({ needsAction: () => false } as any);
    const res = await runPlay(fake, { waitTimeoutMs: 80 });
    expect(res.needsAction).toBe(false);
  });
});
