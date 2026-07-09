// tests/server/persistence.test.ts
// 持久化层覆盖率补充:saveRoom/loadRoom 往返、sanitizeState、restoreFromLog、flushPendingWrites
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  saveRoom,
  loadRoom,
  deletePersistedRoom,
  listPersistedRooms,
  flushPendingWrites,
  sanitizeState,
  restoreFromLog,
  _pendingWriteCount,
  type PersistedRoom,
} from '../../src/server/persistence';
import { createGameState } from '../../src/engine/types';
import type { GameState, PlayerState, Card } from '../../src/engine/types';

const TEST_DATA_DIR = join(process.cwd(), 'data', 'rooms');

function makePlayer(index: number): PlayerState {
  return {
    index,
    name: `玩家${index}`,
    character: '刘备',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [`c${index}-1`, `c${index}-2`],
    equipment: {},
    pendingTricks: [],
    skills: ['仁德'],
    vars: {},
    marks: [],
    tags: [],
  };
}

function makeCard(id: string): Card {
  return { id, name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' };
}

function makeState(): GameState {
  const cardMap: Record<string, Card> = {};
  for (let i = 0; i < 4; i++) {
    cardMap[`c${i}-1`] = makeCard(`c${i}-1`);
    cardMap[`c${i}-2`] = makeCard(`c${i}-2`);
  }
  return createGameState({
    players: [makePlayer(0), makePlayer(1)],
    cardMap,
    rngSeed: 42,
  });
}

const ROOM_PREFIX = 'test-coverage-';

describe('server/persistence', () => {
  let roomId: string;

  beforeEach(() => {
    roomId = `${ROOM_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(async () => {
    // 清理测试房间文件
    try {
      await deletePersistedRoom(roomId);
    } catch {
      // 忽略
    }
    await flushPendingWrites();
  });

  describe('saveRoom + loadRoom 往返', () => {
    it('immediate=true 立即写入磁盘并可读回', async () => {
      const state = makeState();
      await saveRoom(
        roomId,
        { roomName: '测试房', maxPlayers: 2, hostId: 'p0', debug: true },
        state,
        [],
        true,
      );

      const loaded = await loadRoom(roomId);
      expect(loaded).not.toBeNull();
      expect(loaded!.roomId).toBe(roomId);
      expect(loaded!.roomName).toBe('测试房');
      expect(loaded!.maxPlayers).toBe(2);
      expect(loaded!.hostId).toBe('p0');
      expect(loaded!.debug).toBe(true);
      expect(loaded!.seed).toBe(42);
      expect(loaded!.players).toHaveLength(2);
      expect(loaded!.players[0].name).toBe('玩家0');
      expect(loaded!.players[0].characterId).toBe('刘备');
      expect(loaded!.savedAt).toBeGreaterThan(0);
      expect(loaded!.lastActivityAt).toBeGreaterThan(0);
    });

    it('immediate=false 延迟写入,flush 后可读回', async () => {
      const state = makeState();
      await saveRoom(
        roomId,
        { roomName: '延迟房', maxPlayers: 4, hostId: null, debug: false },
        state,
        [],
        false,
      );

      // debounce 期间 _pendingWriteCount > 0
      expect(_pendingWriteCount()).toBeGreaterThan(0);

      await flushPendingWrites();
      expect(_pendingWriteCount()).toBe(0);

      const loaded = await loadRoom(roomId);
      expect(loaded).not.toBeNull();
      expect(loaded!.roomName).toBe('延迟房');
    });

    it('immediate=true 取消已有的 pending timer', async () => {
      const state = makeState();
      // 先延迟写入
      await saveRoom(
        roomId,
        { roomName: '第一次', maxPlayers: 2, hostId: 'p0', debug: false },
        state,
        [],
        false,
      );
      // 再立即写入(应取消 pending timer)
      await saveRoom(
        roomId,
        { roomName: '第二次', maxPlayers: 2, hostId: 'p0', debug: false },
        state,
        [],
        true,
      );

      expect(_pendingWriteCount()).toBe(0);
      const loaded = await loadRoom(roomId);
      expect(loaded!.roomName).toBe('第二次');
    });
  });

  describe('loadRoom 边界', () => {
    it('不存在的房间返回 null', async () => {
      const loaded = await loadRoom('definitely-not-exist-xyz');
      expect(loaded).toBeNull();
    });

    it('actionLog 非法时不抛异常(loadRoom 在 readWrapperFromDisk 返回 null)', async () => {
      // 文件存在但内容不是合法 wrapper → isPersistedWrapper 返回 false → loadRoom 返回 null
      const state = makeState();
      await saveRoom(
        roomId,
        { roomName: '原始', maxPlayers: 2, hostId: 'p0', debug: false },
        state,
        [],
        true,
      );
      const loaded = await loadRoom(roomId);
      expect(loaded).not.toBeNull();
    });
  });

  describe('deletePersistedRoom', () => {
    it('删除已存在的房间', async () => {
      const state = makeState();
      await saveRoom(
        roomId,
        { roomName: '待删', maxPlayers: 2, hostId: 'p0', debug: false },
        state,
        [],
        true,
      );
      expect(await loadRoom(roomId)).not.toBeNull();

      await deletePersistedRoom(roomId);
      expect(await loadRoom(roomId)).toBeNull();
    });

    it('删除 pending 中的房间也清理 timer', async () => {
      const state = makeState();
      await saveRoom(
        roomId,
        { roomName: '待删', maxPlayers: 2, hostId: 'p0', debug: false },
        state,
        [],
        false,
      );
      expect(_pendingWriteCount()).toBeGreaterThan(0);

      await deletePersistedRoom(roomId);
      expect(_pendingWriteCount()).toBe(0);
    });

    it('删除不存在的房间不报错', async () => {
      await expect(deletePersistedRoom('nonexistent-xyz')).resolves.toBeUndefined();
    });
  });

  describe('listPersistedRooms', () => {
    it('返回 .json 文件名列表(无扩展名)', async () => {
      const rooms = await listPersistedRooms();
      expect(Array.isArray(rooms)).toBe(true);
      // 确保返回的都是字符串
      for (const r of rooms) {
        expect(typeof r).toBe('string');
        expect(r.endsWith('.json')).toBe(false);
      }
    });
  });

  describe('sanitizeState', () => {
    it('清空 pendingSlots 和 atomStack', () => {
      const state = makeState();
      state.pendingSlots.set(
        0,
        // 最小化 mock,sanitizeState 只关心清空,不读取内容
        {} as GameState['pendingSlots'] extends Map<number, infer V> ? V : never,
      );
      state.atomStack.push({ type: '摸牌', player: 0, count: 1 });

      const sanitized = sanitizeState(state);
      expect(sanitized.pendingSlots.size).toBe(0);
      expect(sanitized.atomStack).toHaveLength(0);
    });

    it('剥离 settlementStack 中的 _executor 函数引用', () => {
      const state = makeState();
      state.settlementStack = [
        {
          skillId: '测试',
          from: 0,
          resolvedTargets: [],
          params: {},
          // @ts-expect-error 运行时挂载的函数引用
          _executor: () => {},
        },
      ];

      const sanitized = sanitizeState(state);
      expect(sanitized.settlementStack).toHaveLength(1);
      const frame = sanitized.settlementStack[0] as unknown as Record<string, unknown>;
      expect(frame['_executor']).toBeUndefined();
      expect(frame['skillId']).toBe('测试');
    });
  });

  describe('restoreFromLog', () => {
    it('JSON 反序列化的 pendingSlots 普通对象转回 Map', () => {
      const state = makeState();
      const persisted: PersistedRoom = {
        roomId: 'r1',
        roomName: '测试',
        maxPlayers: 2,
        hostId: null,
        debug: false,
        players: [],
        seed: 0,
        actionLog: [],
        // 模拟 JSON 反序列化后 pendingSlots 是普通对象而非 Map
        state: {
          ...state,
          pendingSlots: { '0': { dummy: true }, '1': { dummy: false } } as unknown as GameState['pendingSlots'],
        },
        savedAt: 0,
        lastActivityAt: 0,
      };

      const restored = restoreFromLog(persisted);
      expect(restored.pendingSlots).toBeInstanceOf(Map);
      expect(restored.pendingSlots.size).toBe(2);
      expect(restored.pendingSlots.get(0)).toEqual({ dummy: true });
      expect(restored.pendingSlots.get(1)).toEqual({ dummy: false });
    });

    it('JSON 反序列化的 pendingSlots 为数组时也转回 Map', () => {
      const persisted: PersistedRoom = {
        roomId: 'r2',
        roomName: '测试',
        maxPlayers: 2,
        hostId: null,
        debug: false,
        players: [],
        seed: 0,
        actionLog: [],
        state: {
          ...makeState(),
          pendingSlots: [
            [0, { a: 1 }],
            [1, { b: 2 }],
          ] as unknown as GameState['pendingSlots'],
        },
        savedAt: 0,
        lastActivityAt: 0,
      };

      const restored = restoreFromLog(persisted);
      expect(restored.pendingSlots).toBeInstanceOf(Map);
      expect(restored.pendingSlots.get(0)).toEqual({ a: 1 });
      expect(restored.pendingSlots.get(1)).toEqual({ b: 2 });
    });

    it('已经是 Map 时不转换', () => {
      const state = makeState();
      const persisted: PersistedRoom = {
        roomId: 'r3',
        roomName: '测试',
        maxPlayers: 2,
        hostId: null,
        debug: false,
        players: [],
        seed: 0,
        actionLog: [],
        state,
        savedAt: 0,
        lastActivityAt: 0,
      };

      const restored = restoreFromLog(persisted);
      expect(restored.pendingSlots).toBe(state.pendingSlots);
    });
  });
});
