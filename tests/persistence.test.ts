// LEGACY TEST: references deleted v2 modules - skipped
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'persistence-test-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadModule() {
  return import('../src/server/persistence');
}

async function makeState() {
  const { createInitialState } = await import('@engine/state');
  const { allCharacters } = await import('@engine/characters');
  const characters = allCharacters.slice(0, 3);
  return createInitialState({
    players: characters.map((c, i) => ({ name: `P${i + 1}`, characterId: c.name, role: i === 0 ? '主公' : '反贼' })),
    seed: 42,
    characterMap: Object.fromEntries(characters.map(c => [c.name, c])),
  });
}

const META = { roomName: 'test-room', maxPlayers: 3, hostId: null, debug: false };

describe.skip('persistence', () => {
  it('saveRoom + loadRoom 往返一致', async () => {
    const { saveRoom, loadRoom } = await loadModule();
    const state = await makeState();
    await saveRoom('room-1', META, state, [{ type: '结束回合', player: 'P1' }], true);
    const loaded = await loadRoom('room-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.seed).toBe(42);
    expect(loaded?.players).toHaveLength(3);
    expect(loaded?.actionLog).toHaveLength(1);
    expect(loaded?.actionLog[0]).toEqual({ type: '结束回合', player: 'P1' });
  });

  it('loadRoom 返回 null 当文件不存在', async () => {
    const { loadRoom } = await loadModule();
    expect(await loadRoom('nonexistent')).toBeNull();
  });

  it('deletePersistedRoom 移除文件', async () => {
    const { saveRoom, deletePersistedRoom, loadRoom } = await loadModule();
    const state = await makeState();
    await saveRoom('room-2', META, state, [], true);
    expect(await loadRoom('room-2')).not.toBeNull();
    await deletePersistedRoom('room-2');
    expect(await loadRoom('room-2')).toBeNull();
  });

  it('listPersistedRooms 返回所有已保存房间', async () => {
    const { saveRoom, listPersistedRooms } = await loadModule();
    const state = await makeState();
    await saveRoom('room-a', META, state, [], true);
    await saveRoom('room-b', META, state, [], true);
    const ids = await listPersistedRooms();
    expect(ids).toContain('room-a');
    expect(ids).toContain('room-b');
  });
});

describe.skip('persistence 防抖路径', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'persistence-debounce-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  it('非 immediate 模式 1s 内不写盘', async () => {
    vi.useFakeTimers();
    try {
      const { saveRoom, loadRoom, _pendingWriteCount } = await loadModule();
      const state = await makeState();
      await saveRoom('debounce-1', META, state, []);
      expect(_pendingWriteCount()).toBe(1);
      expect(await loadRoom('debounce-1')).toBeNull();
      await vi.advanceTimersByTimeAsync(999);
      expect(await loadRoom('debounce-1')).toBeNull();
      await vi.advanceTimersByTimeAsync(2);
      expect(await loadRoom('debounce-1')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('连续 saveRoom 合并到一次写入（最后 actionLog 胜出）', async () => {
    vi.useFakeTimers();
    try {
      const { saveRoom, loadRoom, _pendingWriteCount } = await loadModule();
      const state = await makeState();

      await saveRoom('debounce-2', META, state, [{ type: '结束回合', player: 'P1' }]);
      expect(_pendingWriteCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(500);
      await saveRoom('debounce-2', META, state, [
        { type: '结束回合', player: 'P1' },
        { type: '结束回合', player: 'P2' },
      ]);
      expect(_pendingWriteCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(500);
      await saveRoom('debounce-2', META, state, [
        { type: '结束回合', player: 'P1' },
        { type: '结束回合', player: 'P2' },
        { type: '结束回合', player: 'P3' },
      ]);
      expect(_pendingWriteCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);

      const loaded = await loadRoom('debounce-2');
      expect(loaded?.actionLog).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushPendingWrites 刷写（防止进程退出丢数据）', async () => {
    vi.useFakeTimers();
    try {
      const { saveRoom, loadRoom, flushPendingWrites, _pendingWriteCount } = await loadModule();
      const state = await makeState();
      await saveRoom('flush-1', META, state, []);
      expect(_pendingWriteCount()).toBe(1);
      expect(await loadRoom('flush-1')).toBeNull();
      await flushPendingWrites();
      expect(_pendingWriteCount()).toBe(0);
      expect(await loadRoom('flush-1')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skip('restoreToState 事件重放', () => {
  it('无 actionLog 时重建初始状态', async () => {
    const { saveRoom, loadRoom, restoreToState } = await loadModule();
    const state = await makeState();
    await saveRoom('replay-empty', META, state, [], true);
    const persisted = (await loadRoom('replay-empty'))!;
    const restored = restoreToState(persisted);
    expect(restored.meta.seed).toBe(42);
    expect(restored.players.P1.health).toBe(state.players.P1.health);
    expect(restored.players.P1.hand).toEqual(state.players.P1.hand);
  });

  it('同 seed + 同 actionLog 产生与原始状态完全一致的结果', async () => {
    const { saveRoom, loadRoom, restoreToState } = await loadModule();
    const { createInitialState } = await import('@engine/state');
    const { allCharacters } = await import('@engine/characters');
    const { engine } = await import('@engine/engine');
    const characters = allCharacters.slice(0, 3);

    const initConfig = {
      players: characters.map((c, i) => ({ name: `P${i + 1}`, characterId: c.name, role: i === 0 ? '主公' as const : '反贼' as const })),
      seed: 42,
      characterMap: Object.fromEntries(characters.map(c => [c.name, c])),
    };

    const original = createInitialState(initConfig);

    const actions: Array<{ type: '结束回合'; player: string }> = [
      { type: '结束回合', player: 'P1' },
      { type: '结束回合', player: 'P2' },
    ];
    let lastState = original;
    for (const a of actions) {
      lastState = engine(lastState, a).state;
    }
    const finalOriginal = lastState;

    await saveRoom('replay-determinism', META, finalOriginal, actions, true);
    const persisted = (await loadRoom('replay-determinism'))!;
    const restored = restoreToState(persisted);

    expect(restored.meta.seed).toBe(finalOriginal.meta.seed);
    expect(restored.meta.round).toBe(finalOriginal.meta.round);
    expect(restored.meta.turnNumber).toBe(finalOriginal.meta.turnNumber);
    expect(restored.currentPlayer).toBe(finalOriginal.currentPlayer);
    expect(restored.phase).toBe(finalOriginal.phase);
    expect(Object.keys(restored.players).sort()).toEqual(Object.keys(finalOriginal.players).sort());
    for (const name of Object.keys(finalOriginal.players)) {
      expect(restored.players[name].health).toBe(finalOriginal.players[name].health);
      expect(restored.players[name].hand).toEqual(finalOriginal.players[name].hand);
    }
    expect(restored.zones.deck.length).toBe(finalOriginal.zones.deck.length);
    expect(restored.zones.discardPile.length).toBe(finalOriginal.zones.discardPile.length);
  });

  it('restoreToState 注册角色技能触发器（不依赖 startGame 流程）', async () => {
    const { saveRoom, loadRoom, restoreToState } = await loadModule();
    const { createInitialState } = await import('@engine/state');
    const { allCharacters } = await import('@engine/characters');
    const characters = allCharacters.slice(0, 3);
    const state = createInitialState({
      players: characters.map((c, i) => ({ name: `P${i + 1}`, characterId: c.name, role: i === 0 ? '主公' : '反贼' })),
      seed: 42,
      characterMap: Object.fromEntries(characters.map(c => [c.name, c])),
    });

    await saveRoom('replay-triggers', META, state, [], true);
    const persisted = (await loadRoom('replay-triggers'))!;
    const restored = restoreToState(persisted);

    // [P5-T3] 阶段 D：不再验证 state.triggers（已删），改为验证 PlayerState.skills
    const hasSkills = Object.values(restored.players).some(p => p.skills.length > 0);
    expect(hasSkills).toBe(true);
  });
});
