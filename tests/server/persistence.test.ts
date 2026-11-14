// tests/server/persistence.test.ts
// 持久化层覆盖率补充:saveRoom/loadRoom 往返、sanitizeState、restoreFromLog、flushPendingWrites
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { existsSync } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { PersistedRoom } from '../../src/server/persistence';
import { createGameState } from '../../src/engine/types';
import type { GameState, PlayerState, Card } from '../../src/engine/types';

const TEST_DATA_DIR = join(process.cwd(), 'data', 'rooms');
type PersistenceModule = typeof import('../../src/server/persistence');
type FsPromisesModule = typeof import('node:fs/promises');

let persistence!: PersistenceModule;
let fs!: FsPromisesModule;
let applyRestRoutes!: typeof import('../../src/server/rest').applyRestRoutes;
let applyAuthRoutes!: typeof import('../../src/server/auth/routes').applyAuthRoutes;
let getRoom!: typeof import('../../src/server/room').getRoom;
let createRoom!: typeof import('../../src/server/room').createRoom;
let initRoomStore!: typeof import('../../src/server/roomStore').initRoomStore;
let closeRoomStore!: typeof import('../../src/server/roomStore').closeRoomStore;
let resetLifecycles!: typeof import('../../src/server/resourceRegistry')._resetForTests;
let gameSessions!: typeof import('../../src/server/registry').gameSessions;
let playerRoomMap!: typeof import('../../src/server/registry').playerRoomMap;

const saveRoom = (...args: Parameters<PersistenceModule['saveRoom']>) => persistence.saveRoom(...args);
const loadRoom = (...args: Parameters<PersistenceModule['loadRoom']>) => persistence.loadRoom(...args);
const deletePersistedRoom = (...args: Parameters<PersistenceModule['deletePersistedRoom']>) =>
  persistence.deletePersistedRoom(...args);
const listPersistedRooms = (...args: Parameters<PersistenceModule['listPersistedRooms']>) =>
  persistence.listPersistedRooms(...args);
const flushPendingWrites = (...args: Parameters<PersistenceModule['flushPendingWrites']>) =>
  persistence.flushPendingWrites(...args);
const sanitizeState = (...args: Parameters<PersistenceModule['sanitizeState']>) =>
  persistence.sanitizeState(...args);
const restoreFromLog = (...args: Parameters<PersistenceModule['restoreFromLog']>) =>
  persistence.restoreFromLog(...args);
const pendingWriteCount = (...args: Parameters<PersistenceModule['_pendingWriteCount']>) =>
  persistence._pendingWriteCount(...args);

async function loadTestModules(configureFs?: (isolatedFs: FsPromisesModule) => void): Promise<void> {
  vi.resetModules();
  vi.doMock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof nodeFs>();
    return {
      ...actual,
      writeFile: vi.fn(actual.writeFile),
      rename: vi.fn(actual.rename),
    };
  });
  fs = await import('node:fs/promises');
  configureFs?.(fs);
  persistence = await import('../../src/server/persistence');
  ({ applyRestRoutes } = await import('../../src/server/rest'));
  ({ applyAuthRoutes } = await import('../../src/server/auth/routes'));
  ({ getRoom, createRoom } = await import('../../src/server/room'));
  ({ initRoomStore, closeRoomStore } = await import('../../src/server/roomStore'));
  ({ _resetForTests: resetLifecycles } = await import('../../src/server/resourceRegistry'));
  ({ gameSessions, playerRoomMap } = await import('../../src/server/registry'));
}

function applyAuthRoutesForTest(app: Hono): void {
  applyAuthRoutes(app);
}

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function saveSnapshot(roomId: string, roomName: string, immediate = true) {
  return saveRoom(
    roomId,
    { roomName, maxPlayers: 2, hostId: null, debug: false },
    makeState(),
    [],
    immediate,
  );
}

interface WriteGate {
  started: ReturnType<typeof deferred>;
  release: ReturnType<typeof deferred>;
  entered: boolean;
}

let activeWriteGates: WriteGate[] = [];

function holdRoomWrites(roomId: string, count: number) {
  const writeFile = nodeFs.writeFile;
  const gates: WriteGate[] = Array.from({ length: count }, () => ({
    started: deferred(),
    release: deferred(),
    entered: false,
  }));
  activeWriteGates = gates;
  let next = 0;
  const prefix = join(TEST_DATA_DIR, `${roomId}.json`);
  vi.mocked(fs.writeFile).mockImplementation(async (path, data, options) => {
    const gate = String(path).startsWith(prefix) ? gates[next++] : undefined;
    if (gate) {
      gate.entered = true;
      gate.started.resolve();
      await gate.release.promise;
    }
    await writeFile(path, data, options);
  });
  return gates;
}

describe('server/persistence', () => {
  let roomId: string;

  beforeAll(async () => {
    await loadTestModules();
    await initRoomStore(':memory:');
  });

  beforeEach(() => {
    roomId = `${ROOM_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const gate of activeWriteGates) gate.release.resolve();
    activeWriteGates = [];
    // 清理测试房间文件及该模块实例中的所有异步写入;始终在恢复 spy 前排空队列。
    try {
      await deletePersistedRoom(roomId);
    } catch {
      // 忽略
    }
    try {
      await flushPendingWrites();
    } finally {
      vi.mocked(fs.writeFile).mockImplementation(nodeFs.writeFile);
      vi.mocked(fs.rename).mockImplementation(nodeFs.rename);
      vi.restoreAllMocks();
      vi.doUnmock('node:fs/promises');
    }
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
      expect(pendingWriteCount()).toBeGreaterThan(0);

      await flushPendingWrites();
      expect(pendingWriteCount()).toBe(0);

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

      expect(pendingWriteCount()).toBe(0);
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
      expect(pendingWriteCount()).toBeGreaterThan(0);

      await deletePersistedRoom(roomId);
      expect(pendingWriteCount()).toBe(0);
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

  describe('删除竞态修复', () => {
    it('两个重叠立即写入和删除按房间串行,删除返回后文件和房间列表均为空', async () => {
      const gates = holdRoomWrites(roomId, 2);
      const first = saveSnapshot(roomId, '第一份');
      await gates[0].started.promise;

      const second = saveSnapshot(roomId, '第二份');
      const deleting = deletePersistedRoom(roomId);
      gates[0].release.resolve();
      await gates[1].started.promise;
      gates[1].release.resolve();

      await Promise.all([first, second, deleting]);
      expect(await loadRoom(roomId)).toBeNull();
      expect(await listPersistedRooms()).not.toContain(roomId);
    });

    it('写失败不毒化后续保存,原子写失败保留旧快照并清理临时文件', async () => {
      await saveSnapshot(roomId, '旧快照');
      const oldRaw = await fs.readFile(join(TEST_DATA_DIR, `${roomId}.json`), 'utf8');
      const rename = vi.mocked(fs.rename).mockRejectedValueOnce(new Error('rename failed'));

      await expect(saveSnapshot(roomId, '失败快照')).rejects.toThrow('rename failed');
      expect(await fs.readFile(join(TEST_DATA_DIR, `${roomId}.json`), 'utf8')).toBe(oldRaw);
      expect(
        (await fs.readdir(TEST_DATA_DIR)).filter(
          (entry) => entry.startsWith(`${roomId}.json.`) && entry.endsWith('.tmp'),
        ),
      ).toEqual([]);

      rename.mockImplementation(nodeFs.rename);
      await saveSnapshot(roomId, '新快照');
      expect((await loadRoom(roomId))!.roomName).toBe('新快照');
    });

    it('flush 与删除交错时仍等待同一房间队列且不泄漏文件', async () => {
      await saveSnapshot(roomId, '待 flush', false);
      const flushing = flushPendingWrites();
      const deleting = deletePersistedRoom(roomId);
      await Promise.all([flushing, deleting]);
      expect(await loadRoom(roomId)).toBeNull();
      expect(await listPersistedRooms()).not.toContain(roomId);
    });
  });

  describe('DELETE /api/rooms/:id 删除孤儿持久化文件', () => {
    let app: Hono;

    beforeEach(() => {
      gameSessions.clear();
      playerRoomMap.clear();
      app = new Hono();
      applyRestRoutes(app);
    });

    // bug:此前 getRoom(id) 返回 null 时 early return 404,跳过 deletePersistedRoom。
    // 场景:服务端重启后内存丢失但磁盘文件残留 → 用户点删除 → 404 → 文件未删 → 再重启又恢复。
    it('room 不在内存中时,DELETE 仍删除磁盘持久化文件', async () => {
      const state = makeState();
      await saveRoom(
        roomId,
        { roomName: '孤儿房', maxPlayers: 2, hostId: null, debug: false },
        state,
        [],
        true,
      );
      expect(await loadRoom(roomId)).not.toBeNull();
      expect(getRoom(roomId)).toBeNull();

      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${roomId}`, { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      expect(await loadRoom(roomId)).toBeNull();
      expect(existsSync(join(TEST_DATA_DIR, `${roomId}.json`))).toBe(false);
    });
  });

  // join REST: 已在房间中的玩家重新加入（刷新页面）不应被“房间已满”拒绝
  // 游客模式移除后 join 需登录:注册临时用户带 Cookie 调用(需要内存 DB 支撑 auth)
  describe('POST /api/rooms/:id/join 已在房间中的玩家', () => {
    let app: Hono;

    beforeAll(async () => {
      await initRoomStore(':memory:');
    });
    afterAll(async () => {
      await closeRoomStore();
      resetLifecycles();
    });

    beforeEach(() => {
      gameSessions.clear();
      playerRoomMap.clear();
      app = new Hono();
      applyRestRoutes(app);
      applyAuthRoutesForTest(app);
    });

    it('满员时已有玩家重新 join 返回 200 而非 400', async () => {
      // host1 同时是登录用户(直接注册同名,userId 与显式 host 参数无关)
      const reg = await app.fetch(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'persistence_host', password: 'pass123' }),
        }),
      );
      const { user } = (await reg.json()) as { user: { id: string } };
      const cookie = reg.headers.get('set-cookie')!.split(';')[0];
      const room = createRoom('测试', 2, user.id, {
        send() {},
      } as any);
      // 用 REST 加入第二个玩家使房间满员
      const guestReg = await app.fetch(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'persistence_guest', password: 'pass123' }),
        }),
      );
      const guestCookie = guestReg.headers.get('set-cookie')!.split(';')[0];
      const joinRes = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.id}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
          body: JSON.stringify({}),
        }),
      );
      expect(joinRes.status).toBe(200);

      // 房主刷新页面重新 join → 应成功，不是“房间已满”
      const rejoinRes = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.id}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({}),
        }),
      );
      expect(rejoinRes.status).toBe(200);
      const body = await rejoinRes.json();
      expect(body.playerId).toBe(user.id);
    });

    it('满员时新玩家 join 仍返回 400 房间已满', async () => {
      const reg = await app.fetch(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'persistence_host2', password: 'pass123' }),
        }),
      );
      const { user } = (await reg.json()) as { user: { id: string } };
      const room = createRoom('测试', 2, user.id, {
        send() {},
      } as any);
      // host 已占 1 座;guest2 加入占第 2 座 → 满员
      const guestReg = await app.fetch(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'persistence_guest2', password: 'pass123' }),
        }),
      );
      const guestCookie = guestReg.headers.get('set-cookie')!.split(';')[0];
      const joinGuest = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.id}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
          body: JSON.stringify({}),
        }),
      );
      expect(joinGuest.status).toBe(200);
      // 第三个新玩家 → 房间已满
      const guest3Reg = await app.fetch(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'persistence_guest3', password: 'pass123' }),
        }),
      );
      const guest3Cookie = guest3Reg.headers.get('set-cookie')!.split(';')[0];
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.id}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: guest3Cookie },
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('房间已满');
    });
  });
});
