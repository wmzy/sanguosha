// tests/ai-mcp/playHandler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runPlay, type PlayState } from '../../src/ai-mcp/playHandler';
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
    consumeActionRejected: () => false,
    loadSkillActions: vi.fn().mockResolvedValue(undefined),
    isSpectator: false,
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
    // view 为 null → recommendedAction 为 null（字段已透传）
    expect(res.recommendedAction).toBeNull();
    // 增量结构：lobby 阶段无 view → null
    expect(res.stateDiff).toBeNull();
    expect(res.myHand).toBeNull();
    expect(res.newLog).toEqual([]);
  });

  it('游戏结束时立即返回', async () => {
    const fake = makeFake({ phase: 'ended', gameOverWinner: '主公' });
    const res = await runPlay(fake, { waitTimeoutMs: 100 });
    expect(res.gameOver).toEqual({ winner: '主公' });
  });

  it('执行传入的 action', async () => {
    const fake = makeFake();
    const action: EngineClientMessage = {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: 'c1', targets: [1] },
      baseSeq: 0,
    };
    await runPlay(fake, { action: { message: action }, waitTimeoutMs: 100 });
    expect(fake.sendAction).toHaveBeenCalledWith(action);
  });

  it('未轮到自己且超时后返回 needsAction=false', async () => {
    const fake = makeFake({ needsAction: () => false });
    const res = await runPlay(fake, { waitTimeoutMs: 80 });
    expect(res.needsAction).toBe(false);
    expect(res.stateDiff).toBeNull();
  });

  it('action 被服务端拒后报告 rejected', async () => {
    const fake = makeFake({ consumeActionRejected: () => true });
    const action: EngineClientMessage = {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: 'c1' },
      baseSeq: 0,
    };
    const res = await runPlay(fake, { action: { message: action }, waitTimeoutMs: 80 });
    expect(res.lastActionResult).toBe('rejected');
    expect(res.stateDiff).toBeNull();
  });
});

describe('runPlay 增量 diff', () => {
  function makeViewStub(overrides: Partial<unknown> = {}) {
    return {
      viewer: 0,
      currentPlayerIndex: 0,
      phase: 'play',
      turn: { round: 1 },
      players: [
        { index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4, alive: true, handCount: 4, hand: [], equipment: {}, skills: ['仁德'], identity: '主公' },
        { index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4, alive: true, handCount: 4, equipment: {}, skills: ['咆哮'], identity: '反贼' },
      ],
      pending: null,
      zones: { deckCount: 120, discardPileCount: 0 },
      log: [],
      ...overrides,
    } as unknown as Parameters<typeof import('../../src/ai-mcp/viewProjector').projectView>[0];
  }

  it('首次调用 stateDiff 为全量（所有玩家全字段）', async () => {
    const view = makeViewStub();
    const fake = makeFake({ view });
    const state: PlayState = { lastView: null };
    const res = await runPlay(fake, { waitTimeoutMs: 100, state });
    expect(res.stateDiff).not.toBeNull();
    expect(res.stateDiff!.players).toHaveLength(2);
    // 首次 diff 每个玩家带全字段
    expect(res.stateDiff!.players[0]).toHaveProperty('character');
    expect(res.stateDiff!.players[0]).toHaveProperty('health');
    expect(res.stateDiff!.zones).toEqual({ deckCount: 120, discardPileCount: 0 });
    // state 被更新
    expect(state.lastView).not.toBeNull();
  });

  it('第二次调用 stateDiff 只含变化字段', async () => {
    const view1 = makeViewStub();
    const fake = makeFake({ view: view1 });
    const state: PlayState = { lastView: null };
    await runPlay(fake, { waitTimeoutMs: 100, state });

    // P1 掉了 1 血, P0 摸了 1 牌
    const view2 = makeViewStub({
      players: [
        { index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4, alive: true, handCount: 5, hand: [], equipment: {}, skills: ['仁德'], identity: '主公' },
        { index: 1, name: 'P1', character: '张飞', health: 3, maxHealth: 4, alive: true, handCount: 4, equipment: {}, skills: ['咆哮'], identity: '反贼' },
      ],
      zones: { deckCount: 119, discardPileCount: 0 },
    });
    const fake2 = makeFake({ view: view2 });
    const res = await runPlay(fake2, { waitTimeoutMs: 100, state });

    // 只有 P0(handCount) 和 P1(health) 的变化字段
    expect(res.stateDiff!.players).toHaveLength(2);
    const p0Diff = res.stateDiff!.players.find((p) => p.index === 0)!;
    expect(p0Diff).toMatchObject({ index: 0, handCount: 5 });
    expect(p0Diff).not.toHaveProperty('character');
    expect(p0Diff).not.toHaveProperty('health');

    const p1Diff = res.stateDiff!.players.find((p) => p.index === 1)!;
    expect(p1Diff).toMatchObject({ index: 1, health: 3 });
    expect(p1Diff).not.toHaveProperty('handCount');

    // deckCount 变了, discardPileCount 没变 → zones 仍包含全量（两个值都给）
    expect(res.stateDiff!.zones).toEqual({ deckCount: 119, discardPileCount: 0 });
  });

  it('无变化时 stateDiff.players 为空数组', async () => {
    const view = makeViewStub();
    const fake = makeFake({ view });
    const state: PlayState = { lastView: null };
    await runPlay(fake, { waitTimeoutMs: 100, state });

    // 同样的 view 再来一次
    const fake2 = makeFake({ view });
    const res = await runPlay(fake2, { waitTimeoutMs: 100, state });
    expect(res.stateDiff!.players).toHaveLength(0);
    expect(res.stateDiff!.zones).toBeUndefined();
  });

  it('myHand 始终返回全量', async () => {
    const view = makeViewStub({
      players: [
        { index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4, alive: true, handCount: 2, hand: [{ id: 'c1', name: '杀', suit: 'spade', rank: 5 } as never], equipment: {}, skills: ['仁德'], identity: '主公' },
        { index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4, alive: true, handCount: 4, equipment: {}, skills: ['咆哮'], identity: '反贼' },
      ],
    });
    const fake = makeFake({ view });
    const res = await runPlay(fake, { waitTimeoutMs: 100, state: { lastView: null } });
    expect(res.myHand).toHaveLength(1);
    expect(res.myHand![0]).toMatchObject({ name: '杀' });
  });
});
