// tests/server/snapshot.test.ts
// 验证 debug 快照功能:
// 1. 创建快照:session 存在 → 文件落盘 + 结构完整
// 2. 创建快照:非 debug session → 403
// 3. 创建快照:只读——不改变 state 引用和 seq
// 4. 追加描述:PATCH 后 description 更新
// 5. 追加描述:不存在的 snapshotId → 404
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import { createSnapshot, patchSnapshotDescription } from '../../src/server/snapshot';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';

const SNAPSHOT_DIR = join(process.cwd(), 'data', 'snapshots');

function makeRoom(isDebug = true): Room {
  return {
    id: `snap-test-${Math.random().toString(36).slice(2, 8)}`,
    name: '快照测试房',
    maxPlayers: 4,
    players: new Map(),
    isDebug,
    createdAt: Date.now(),
    status: '进行中',
    config: { name: '测试', timeoutScale: 1, charPool: 'all', handSize: 4 },
  } as unknown as Room;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}

async function readSnapshot(snapshotId: string): Promise<unknown> {
  const raw = await readFile(join(SNAPSHOT_DIR, snapshotId, 'snapshot.json'), 'utf-8');
  return JSON.parse(raw);
}

describe('debug 快照功能', () => {
  afterEach(async () => {
    // 清理测试快照目录
    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(SNAPSHOT_DIR).catch(() => []);
      for (const e of entries) {
        if (e.includes('snap-test-')) {
          await rm(join(SNAPSHOT_DIR, e), { recursive: true });
        }
      }
    } catch {
      // 忽略清理失败
    }
  });

  it('创建快照:debug session 存在 → 返回 snapshotId + 文件落盘 + 结构完整', async () => {
    const room = makeRoom(true);
    const session = new GameSession(room, true, 42);
    await session.startGame(4);
    const state = getState(session);
    // 等 state 就绪
    for (let i = 0; i < 50 && !state.players.length; i++) await sleep(10);
    expect(state.players.length).toBeGreaterThan(0);

    const result = await createSnapshot(session, {
      roomId: room.id,
      perspective: 0,
      frontendSeqs: { 0: 5, 1: 5, 2: 4, 3: 5 },
      frontendViews: { 0: { viewer: 0 } as never, 1: { viewer: 1 } as never },
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('snapshotId');
    const snapshotId = (result as { snapshotId: string }).snapshotId;
    expect(snapshotId).toContain(room.id);

    // 文件落盘
    const snapshot = (await readSnapshot(snapshotId)) as Record<string, unknown>;
    expect(snapshot).toHaveProperty('meta');
    expect(snapshot).toHaveProperty('alignment');
    expect(snapshot).toHaveProperty('backend');
    expect(snapshot).toHaveProperty('frontend');

    const meta = snapshot.meta as Record<string, unknown>;
    expect(meta.roomId).toBe(room.id);
    expect(meta.description).toBeNull();
    expect(meta.debug).toBe(true);

    const backend = snapshot.backend as Record<string, unknown>;
    expect(backend).toHaveProperty('state');
    expect(backend).toHaveProperty('actionLog');
    expect(backend).toHaveProperty('atomHistory');
  }, 15000);

  it('创建快照:非 debug session → 返回 403', async () => {
    const room = makeRoom(false);
    // 非 debug 模式 startGame 使用 room.players.size 而非 playerCount 参数
    // 需要在 map 中放入至少 2 个 fake 玩家才能通过 count >= 2 检查
    room.players.set('p0', {} as never);
    room.players.set('p1', {} as never);
    room.players.set('p2', {} as never);
    room.players.set('p3', {} as never);
    const session = new GameSession(room, false, 42);
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 50 && !state?.players?.length; i++) await sleep(10);

    const result = await createSnapshot(session, {
      roomId: room.id,
      perspective: 0,
      frontendSeqs: {},
      frontendViews: {},
    });

    expect(result).toHaveProperty('error');
    expect((result as { status: number }).status).toBe(403);
  }, 15000);

  it('创建快照:只读——不改变 state 引用和 seq', async () => {
    const room = makeRoom(true);
    const session = new GameSession(room, true, 42);
    await session.startGame(4);
    const state = getState(session);
    // 等 bootstrap 推进到选将 pending(此时 seq 稳定不再自增)
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    // 再等一下确保 seq 稳定
    await sleep(50);

    const seqBefore = state.seq;
    const playersRefBefore = state.players;

    await createSnapshot(session, {
      roomId: room.id,
      perspective: 0,
      frontendSeqs: {},
      frontendViews: {},
    });

    expect(state.seq).toBe(seqBefore);
    expect(state.players).toBe(playersRefBefore);
  }, 15000);

  it('追加描述:PATCH 后 meta.description 更新', async () => {
    const room = makeRoom(true);
    const session = new GameSession(room, true, 42);
    await session.startGame(4);
    const state = getState(session);
    for (let i = 0; i < 50 && !state.players.length; i++) await sleep(10);
    expect(state.players.length).toBeGreaterThan(0);

    const result = await createSnapshot(session, {
      roomId: room.id,
      perspective: 0,
      frontendSeqs: {},
      frontendViews: {},
    });
    const snapshotId = (result as { snapshotId: string }).snapshotId;

    const patchResult = await patchSnapshotDescription(snapshotId, 'P2 出杀后 P0 闪没弹窗');
    expect(patchResult).toEqual({ success: true });

    const snapshot = (await readSnapshot(snapshotId)) as { meta: { description: string } };
    expect(snapshot.meta.description).toBe('P2 出杀后 P0 闪没弹窗');
  }, 15000);

  it('追加描述:不存在的 snapshotId → 返回 404', async () => {
    const result = await patchSnapshotDescription('nonexistent-snapshot-id', '测试');
    expect(result).toHaveProperty('error');
    expect((result as { status: number }).status).toBe(404);
  });

  it('追加描述:含路径遍历的 snapshotId → 返回 400,不访问文件系统', async () => {
    // snapshotId 来自 URL :id,客户端可控。含 / 或 .. 时必须拒绝,防止逃逸快照目录。
    const result = await patchSnapshotDescription('../../../../etc/passwd', '恶意');
    expect(result).toHaveProperty('error');
    expect((result as { status: number }).status).toBe(400);
  });

  it('带 telemetry:写 sidecar 文件(.console.txt/.ws.jsonl/.dom.html)且主快照含元数据', async () => {
    const room = makeRoom(true);
    const session = new GameSession(room, true, 42);
    await session.startGame(4);
    const state = getState(session);
    for (let i = 0; i < 50 && !state.players.length; i++) await sleep(10);
    expect(state.players.length).toBeGreaterThan(0);

    const result = await createSnapshot(session, {
      roomId: room.id,
      perspective: 1,
      frontendSeqs: { 0: 3 },
      frontendViews: { 0: { viewer: 0 } as never },
      telemetry: {
        consoleLog: [
          { time: 1782360000000, level: 'error', message: 'Test error 1' },
          { time: 1782360001000, level: 'warn', message: 'Test warning' },
        ],
        wsMessages: [
          { time: 1782360000000, seat: 0, dir: 'in', msg: { type: 'event', seq: 1 } },
          { time: 1782360000500, seat: 1, dir: 'out', msg: { type: 'action' } },
        ],
        userActions: [{ time: 1782360000000, kind: 'perspective', detail: 2 }],
        domHtml: '<div id="root"><span class="seat">P0</span></div>',
        capturedAt: 1782360000000,
        viewport: { width: 1280, height: 720 },
        url: 'http://localhost:3000/debug/TEST',
      },
    });

    const snapshotId = (result as { snapshotId: string }).snapshotId;

    // 主快照含 telemetry 元数据
    const snapshot = (await readSnapshot(snapshotId)) as {
      telemetry: {
        console: { filename: string; entryCount: number };
        wsMessages: { filename: string; entryCount: number };
        dom: { filename: string; sizeBytes: number };
        userActions: { entryCount: number };
        capturedAt: number;
        viewport: { width: number; height: number };
        url: string;
      };
    };
    expect(snapshot.telemetry).toBeDefined();
    expect(snapshot.telemetry.console.entryCount).toBe(2);
    expect(snapshot.telemetry.wsMessages.entryCount).toBe(2);
    expect(snapshot.telemetry.userActions.entryCount).toBe(1);
    expect(snapshot.telemetry.viewport).toEqual({ width: 1280, height: 720 });

    // sidecar 文件落盘且内容正确(位于快照子目录内)
    const dir = join(SNAPSHOT_DIR, snapshotId);
    const consoleContent = await readFile(join(dir, snapshot.telemetry.console.filename), 'utf-8');
    expect(consoleContent).toContain('Test error 1');
    expect(consoleContent).toContain('Test warning');
    expect(consoleContent).toContain('[error]');
    expect(consoleContent).toContain('[warn]');

    const wsContent = await readFile(join(dir, snapshot.telemetry.wsMessages.filename), 'utf-8');
    expect(wsContent).toContain('"seat":0');
    expect(wsContent).toContain('"dir":"in"');
    // JSONL 格式:每行一个 JSON
    expect(wsContent.trim().split('\n')).toHaveLength(2);

    const domContent = await readFile(join(dir, snapshot.telemetry.dom.filename), 'utf-8');
    expect(domContent).toContain('<span class="seat">P0</span>');
    expect(snapshot.telemetry.dom.sizeBytes).toBe(Buffer.byteLength(domContent, 'utf-8'));
  }, 15000);

  it('不带 telemetry:主快照 telemetry 字段为 undefined,无 sidecar 文件', async () => {
    const room = makeRoom(true);
    const session = new GameSession(room, true, 42);
    await session.startGame(4);
    const state = getState(session);
    for (let i = 0; i < 50 && !state.players.length; i++) await sleep(10);

    const result = await createSnapshot(session, {
      roomId: room.id,
      perspective: 0,
      frontendSeqs: {},
      frontendViews: {},
      // 不提供 telemetry
    });
    const snapshotId = (result as { snapshotId: string }).snapshotId;
    const snapshot = (await readSnapshot(snapshotId)) as { telemetry?: unknown };
    expect(snapshot.telemetry).toBeUndefined();
    // 目录里只有主文件,没有 sidecar
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(SNAPSHOT_DIR, snapshotId));
    expect(files).toEqual(['snapshot.json']);
  }, 15000);
});
