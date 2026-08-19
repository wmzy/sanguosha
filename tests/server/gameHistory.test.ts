// tests/server/gameHistory.test.ts — 房间对局历史(游戏历史)功能的测试。
// 归并说明:覆盖 存储层(gameHistory.ts append/list/get/delete/clear/上限裁剪/孤儿清理)、
// REST 端点(权限/下载)、真实开局到结束的 session 记录与录像格式(isReplayFile 可校验 +
// 回放引擎可重建)。无已有同名测试文件,新建。
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import {
  appendGameHistory,
  listGameHistory,
  getGameReplay,
  deleteGameHistoryEntry,
  clearGameHistory,
  sweepOrphanHistory,
  buildHistoryEntry,
  filterReplayForViewer,
  MAX_ENTRIES_PER_ROOM,
  identityCamp,
  HISTORY_DIR,
  type GameHistoryEntry,
} from '../../src/server/gameHistory';
import { applyRestRoutes } from '../../src/server/rest';
import { applyAuthRoutes } from '../../src/server/auth/routes';
import { initRoomStore, closeRoomStore } from '../../src/server/roomStore';
import { _resetForTests as resetLifecycles } from '../../src/server/lifecycles';
import { gameSessions, playerRoomMap } from '../../src/server/registry';
import { createRoom, getRoom, deleteRoom } from '../../src/server/room';
import { GameSession } from '../../src/server/session';
import { isReplayFile } from '../../src/client/replay/replayFile';
import { availableSeats, getViewAt, totalSteps } from '../../src/client/replay/replayEngine';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';
import type { ConnectionSink } from '../../src/server/connection';
import type { ReplayFile } from '../../src/client/replay/types';

const ROOM_PREFIX = 'hist-test-';

/** 收集 broadcast 的 sink(记录 gameOver 广播) */
function createCaptureSink(captured: unknown[]): ConnectionSink {
  return {
    send: (msg) => captured.push(msg),
    close: () => {},
    isAlive: true,
  };
}

function makeEntry(roomId: string, endedAt: number): GameHistoryEntry {
  return {
    id: `entry-${endedAt}`,
    roomId,
    roomName: '测试房',
    gameMode: '身份局',
    startedAt: endedAt - 60_000,
    endedAt,
    endedReason: '正常',
    winnerLabel: '主公方',
    players: [
      { seat: 0, playerId: 'p0', character: '刘备', identity: '主公', alive: true, hp: 2, won: true },
      { seat: 1, playerId: 'p1', character: '张飞', identity: '反贼', alive: false, hp: 0, won: false },
    ],
    hasReplay: false,
  };
}

function makeReplay(): ReplayFile {
  return {
    format: 'sanguosha-replay',
    version: 2,
    meta: { createdAt: 1, playerCount: 2, characters: ['刘备', '张飞'] },
    baseline: {
      cardMap: {},
      log: [],
      turn: { round: 1, phase: '出牌', vars: {} },
      phase: '出牌',
      currentPlayerIndex: 0,
      zones: { deckCount: 60, discardPileCount: 0, processing: [] },
      settlementStack: [],
      pending: null,
      deadline: null,
      deadlineTotalMs: 0,
      players: [],
    },
    seats: {},
  };
}

describe('server/gameHistory 存储层', () => {
  let roomId: string;

  beforeEach(() => {
    roomId = `${ROOM_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(async () => {
    await clearGameHistory(roomId);
  });

  it('append + list 往返:列表按时间降序(最新在前)', async () => {
    await appendGameHistory(roomId, makeEntry(roomId, 1000), null);
    await appendGameHistory(roomId, makeEntry(roomId, 2000), null);

    const entries = await listGameHistory(roomId);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.endedAt).toBe(2000);
    expect(entries[1]!.endedAt).toBe(1000);
  });

  it('append 带 replay:录像文件可读回且格式校验通过', async () => {
    await appendGameHistory(roomId, makeEntry(roomId, 3000), makeReplay());

    const replay = await getGameReplay(roomId, 'entry-3000');
    expect(replay).not.toBeNull();
    expect(isReplayFile(replay)).toBe(true);
    expect(existsSync(join(HISTORY_DIR, roomId, 'entry-3000.json'))).toBe(true);
  });

  it('deleteEntry 删除条目与录像文件;不存在时返回 false', async () => {
    await appendGameHistory(roomId, makeEntry(roomId, 4000), makeReplay());
    expect(await deleteGameHistoryEntry(roomId, 'entry-4000')).toBe(true);
    expect(await listGameHistory(roomId)).toHaveLength(0);
    expect(existsSync(join(HISTORY_DIR, roomId, 'entry-4000.json'))).toBe(false);
    expect(await deleteGameHistoryEntry(roomId, 'entry-4000')).toBe(false);
  });

  it('超出上限裁剪最旧条目并删除其录像文件', async () => {
    for (let i = 0; i < MAX_ENTRIES_PER_ROOM + 2; i++) {
      await appendGameHistory(roomId, makeEntry(roomId, i), i % 2 === 0 ? makeReplay() : null);
    }
    const entries = await listGameHistory(roomId);
    expect(entries).toHaveLength(MAX_ENTRIES_PER_ROOM);
    // 最新的两条仍在,最旧两条(0/1)被裁剪
    expect(entries[0]!.endedAt).toBe(MAX_ENTRIES_PER_ROOM + 1);
    expect(entries[entries.length - 1]!.endedAt).toBe(2);
    // 被裁剪的录像文件已删除,保留的录像文件还在
    expect(existsSync(join(HISTORY_DIR, roomId, 'entry-0.json'))).toBe(false);
    expect(existsSync(join(HISTORY_DIR, roomId, 'entry-2.json'))).toBe(true);
  });

  it('clear 清空全部', async () => {
    await appendGameHistory(roomId, makeEntry(roomId, 1), null);
    await clearGameHistory(roomId);
    expect(await listGameHistory(roomId)).toHaveLength(0);
    expect(existsSync(join(HISTORY_DIR, roomId))).toBe(false);
  });

  it('非法 roomId(路径穿越)被拒绝', async () => {
    await appendGameHistory('../evil', makeEntry('../evil', 1), null);
    expect(await listGameHistory('../evil')).toHaveLength(0);
    expect(await getGameReplay('../evil', 'x')).toBeNull();
  });

  it('sweepOrphanHistory 清理无主目录,保留存活房间', async () => {
    await appendGameHistory(roomId, makeEntry(roomId, 1), null);
    // 孤儿目录(无对应房间)
    const orphan = join(HISTORY_DIR, 'hist-orphan-room');
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, 'index.json'), '[]');

    await sweepOrphanHistory([roomId]);

    expect(existsSync(join(HISTORY_DIR, roomId))).toBe(true);
    expect(existsSync(orphan)).toBe(false);
  });
});

describe('server/gameHistory 纯构造函数', () => {
  it('identityCamp 映射正确', () => {
    expect(identityCamp('主公')).toBe('主公方');
    expect(identityCamp('忠臣')).toBe('主公方');
    expect(identityCamp('反贼')).toBe('反贼');
    expect(identityCamp('内奸')).toBe('内奸');
    expect(identityCamp(undefined)).toBeNull();
    expect(identityCamp('')).toBeNull();
  });

  it('buildHistoryEntry:胜负/阵营/中断语义', () => {
    const state = createGameState({
      players: [
        { index: 0, name: 'P0', identity: '主公', alive: true, health: 1 },
        { index: 1, name: 'P1', identity: '反贼', alive: false, health: 0 },
      ],
      cardMap: {},
      rngSeed: 1,
    } as never);
    const entry = buildHistoryEntry(state, ['host-0', 'guest-1'], {
      roomId: 'r1',
      roomName: '房',
      gameMode: '身份局',
      startedAt: 100,
      endedAt: 200,
      winner: 0,
      reason: '正常',
    });
    expect(entry.winnerLabel).toBe('主公方');
    expect(entry.players[0]).toMatchObject({ playerId: 'host-0', won: true });
    expect(entry.players[1]).toMatchObject({ playerId: 'guest-1', won: false });

    const drawEntry = buildHistoryEntry(state, [], {
      roomId: 'r1',
      roomName: '房',
      gameMode: '身份局',
      startedAt: 100,
      endedAt: 200,
      winner: undefined,
      reason: '正常',
    });
    expect(drawEntry.winnerLabel).toBe('平局');
    expect(drawEntry.players[0]!.won).toBeNull();

    const abortEntry = buildHistoryEntry(state, [], {
      roomId: 'r1',
      roomName: '房',
      gameMode: '身份局',
      startedAt: 100,
      endedAt: 200,
      winner: 0,
      reason: '中断',
    });
    expect(abortEntry.winnerLabel).toBe('中断');
    expect(abortEntry.players[0]!.won).toBeNull();
  });

  it('filterReplayForViewer:参赛者只保留自己座次;其他人拿旁观座次;旧录像合成旁观', () => {
    const file = makeReplay();
    file.seats = {
      [-1]: { viewer: -1, playerName: '旁观', privateHands: [], identityView: [], events: [] },
      0: {
        viewer: 0,
        playerName: '刘备',
        privateHands: [{ index: 0, hand: [] }],
        identityView: [{ index: 0, identity: '主公', identityHidden: false }],
        events: [],
      },
      1: {
        viewer: 1,
        playerName: '张飞',
        privateHands: [{ index: 1, hand: [] }],
        identityView: [{ index: 1, identity: '反贼', identityHidden: false }],
        events: [],
      },
    };

    // 参赛者(座次 1)只拿自己的 delta
    const p1 = filterReplayForViewer(file, 1);
    expect(Object.keys(p1.seats)).toEqual(['1']);
    expect(p1.seats[1]!.playerName).toBe('张飞');

    // 旁观者/未参赛者只拿旁观座次(无私有手牌)
    const spec = filterReplayForViewer(file, null);
    expect(Object.keys(spec.seats)).toEqual(['-1']);
    expect(spec.seats[-1]!.privateHands).toHaveLength(0);

    // 旧录像(无旁观 delta):从最小玩家座次合成,剥离手牌、身份仅保留明置
    const legacy = makeReplay();
    legacy.seats = {
      0: {
        viewer: 0,
        playerName: '刘备',
        privateHands: [{ index: 0, hand: [] }],
        identityView: [
          { index: 0, identity: '主公', identityHidden: false },
          { index: 1, identity: '反贼', identityHidden: true },
        ],
        events: [],
      },
    };
    const fallback = filterReplayForViewer(legacy, null);
    expect(Object.keys(fallback.seats)).toEqual(['-1']);
    const fd = fallback.seats[-1]!;
    expect(fd.privateHands).toHaveLength(0);
    expect(fd.identityView[0]).toMatchObject({ index: 0, identity: '主公', identityHidden: false });
    expect(fd.identityView[1]).toMatchObject({ index: 1, identityHidden: true });
  });
});

describe('server/gameHistory REST 端点', () => {
  let app: Hono;
  let roomId: string;

  beforeAll(async () => {
    // DELETE 房主校验走会话,需要 auth 路由 + 内存 DB
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
    applyAuthRoutes(app);
    applyRestRoutes(app);
    roomId = `${ROOM_PREFIX}api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  });

  afterEach(async () => {
    await clearGameHistory(roomId);
    const room = getRoom(roomId);
    if (room) deleteRoom(roomId);
  });

  it('GET /api/rooms/:id/history 返回条目列表', async () => {
    await appendGameHistory(roomId, makeEntry(roomId, 1000), null);
    const res = await app.fetch(new Request(`http://localhost/api/rooms/${roomId}/history`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: GameHistoryEntry[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.winnerLabel).toBe('主公方');
  });

  it('GET 录像 + download=1 带 Content-Disposition', async () => {
    await appendGameHistory(roomId, makeEntry(roomId, 1000), makeReplay());
    const res = await app.fetch(
      new Request(`http://localhost/api/rooms/${roomId}/history/entry-1000?download=1`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-type')).toContain('application/json');

    const plain = await app.fetch(
      new Request(`http://localhost/api/rooms/${roomId}/history/entry-1000`),
    );
    const replay = (await plain.json()) as ReplayFile;
    expect(isReplayFile(replay)).toBe(true);
  });

  it('GET 录像重放拉取按请求者过滤座次(playerId=参赛者只拿自己座次)', async () => {
    const replay = makeReplay();
    replay.seats = {
      [-1]: { viewer: -1, playerName: '旁观', privateHands: [], identityView: [], events: [] },
      0: {
        viewer: 0,
        playerName: '刘备',
        privateHands: [{ index: 0, hand: [] }],
        identityView: [],
        events: [],
      },
      1: {
        viewer: 1,
        playerName: '张飞',
        privateHands: [{ index: 1, hand: [] }],
        identityView: [],
        events: [],
      },
    };
    await appendGameHistory(roomId, makeEntry(roomId, 1000), replay);

    // 参赛者 p1 → 只有座次 1
    const asP1 = (await (
      await app.fetch(
        new Request(`http://localhost/api/rooms/${roomId}/history/entry-1000?playerId=p1`),
      )
    ).json()) as ReplayFile;
    expect(Object.keys(asP1.seats)).toEqual(['1']);

    // 未参赛/旁观 → 只有旁观座次
    const asSpectator = (await (
      await app.fetch(
        new Request(`http://localhost/api/rooms/${roomId}/history/entry-1000?playerId=stranger`),
      )
    ).json()) as ReplayFile;
    expect(Object.keys(asSpectator.seats)).toEqual(['-1']);

    // 无 playerId → 同旁观
    const noId = (await (
      await app.fetch(new Request(`http://localhost/api/rooms/${roomId}/history/entry-1000`))
    ).json()) as ReplayFile;
    expect(Object.keys(noId.seats)).toEqual(['-1']);
  });

  it('不存在的录像返回 404', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/rooms/${roomId}/history/nonexistent`),
    );
    expect(res.status).toBe(404);
  });

  it('DELETE 单条:房主成功,非房主 403,缺身份 400,不存在 404', async () => {
    // 游客模式移除后房主校验走会话:注册 host/guest,room.hostId = host.userId
    const reg = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `gh-host-${Date.now()}`, password: 'pass123' }),
      }),
    );
    const hostCookie = reg.headers.get('set-cookie')!.split(';')[0];
    const hostId = ((await reg.json()) as { user: { id: string } }).user.id;
    const guestReg = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `gh-guest-${Date.now()}`, password: 'pass123' }),
      }),
    );
    const guestCookie = guestReg.headers.get('set-cookie')!.split(';')[0];
    const room = createRoom('测试', 2, hostId, createCaptureSink([]));
    try {
      await appendGameHistory(room.id, makeEntry(room.id, 1000), null);

      const del = (cookie: string | null) =>
        app.fetch(
          new Request(`http://localhost/api/rooms/${room.id}/history/entry-1000`, {
            method: 'DELETE',
            ...(cookie ? { headers: { Cookie: cookie } } : {}),
          }),
        );

      expect((await del(null)).status).toBe(400);
      expect((await del(guestCookie)).status).toBe(403);
      expect((await del(hostCookie)).status).toBe(200);
      expect(await listGameHistory(room.id)).toHaveLength(0);
      expect((await del(hostCookie)).status).toBe(404);
    } finally {
      deleteRoom(room.id);
    }
  });

  it('DELETE 清空:仅房主可清空', async () => {
    const reg = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `gh-host2-${Date.now()}`, password: 'pass123' }),
      }),
    );
    const hostCookie = reg.headers.get('set-cookie')!.split(';')[0];
    const hostId = ((await reg.json()) as { user: { id: string } }).user.id;
    const guestReg = await app.fetch(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `gh-guest2-${Date.now()}`, password: 'pass123' }),
      }),
    );
    const guestCookie = guestReg.headers.get('set-cookie')!.split(';')[0];
    const room = createRoom('测试', 2, hostId, createCaptureSink([]));
    try {
      await appendGameHistory(room.id, makeEntry(room.id, 1), null);
      await appendGameHistory(room.id, makeEntry(room.id, 2), null);

      const clear = (cookie: string) =>
        app.fetch(
          new Request(`http://localhost/api/rooms/${room.id}/history`, {
            method: 'DELETE',
            headers: { Cookie: cookie },
          }),
        );

      expect((await clear(guestCookie)).status).toBe(403);
      expect((await clear(hostCookie)).status).toBe(200);
      expect(await listGameHistory(room.id)).toHaveLength(0);
    } finally {
      deleteRoom(room.id);
    }
  });

  it('DELETE /api/rooms/:id 销毁房间时同步清理历史目录', async () => {
    const room = createRoom('测试', 2, 'host-user', createCaptureSink([]));
    await appendGameHistory(room.id, makeEntry(room.id, 1000), makeReplay());
    expect(existsSync(join(HISTORY_DIR, room.id))).toBe(true);

    const res = await app.fetch(
      new Request(`http://localhost/api/rooms/${room.id}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect(existsSync(join(HISTORY_DIR, room.id))).toBe(false);
  });
});

describe('server/gameHistory session 集成(真实开局到结束)', () => {
  // 真实 timers + 主动驱动选将:bootstrap 是 fire-and-forget(dispatch 立即返回,
  // execute 在选将 slot 创建时挂起);选将 slot 需玩家 respond 才 resolve。
  // 录像基线由 onStateChange 在「选将完成」时延迟捕获(与客户端录制一致)。
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeEach(() => {
    // 隔离:清空跨测试残留的全局状态(session/玩家映射),避免上一个测试的
    // 残留定时器/回调干扰下一个测试的 fake timers 推进
    gameSessions.clear();
    playerRoomMap.clear();
  });

  /** 驱动一局 2 人身份局到选将完成:逐个选将 slot respond 第一个候选武将 */
  async function driveCharSelect(session: GameSession, room: ReturnType<typeof createRoom>) {
    const state = (session as unknown as { state: GameState }).state;
    // 等选将 slot 出现
    for (let i = 0; i < 300 && state.pendingSlots.size === 0; i++) await sleep(10);
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    // 逐个选将 slot respond 第一个候选武将;遇非选将 slot(如选将完成后的出牌窗口)即停
    while (state.pendingSlots.size > 0) {
      const target = [...state.pendingSlots.keys()][0]!;
      const slot = state.pendingSlots.get(target)!;
      const atom = slot.atom as { type?: string; target: number; candidates?: Array<{ name: string }> };
      if (atom.type !== '选将询问' || !atom.candidates) break;
      // 反查座次 → playerId(非 debug session 校验 ownerId 匹配 playerNames 映射)
      const playerNames = (session as unknown as { playerNames: Map<string, number> }).playerNames;
      let pid = room.hostId!;
      for (const [p, s] of playerNames) if (s === target) pid = p;
      await session.handleAction(pid, {
        skillId: '系统规则',
        actionType: '选将',
        ownerId: target,
        params: { character: atom.candidates[0]!.name },
        baseSeq: state.seq,
      } as never);
      await sleep(50);
    }
    // 等开局 execute resume 完成发牌/回合启动 + 录像基线捕获
    await sleep(500);
    expect(state.players.every((p: { character: string }) => p.character)).toBe(true);
  }

  it('游戏正常结束:历史条目 + 全座次录像落盘,录像可被回放引擎重建', async () => {
    const captured: unknown[] = [];
    const room = createRoom('历史测试房', 2, 'host-user', createCaptureSink(captured));
    const roomId = room.id;
    const session = new GameSession(room, false, 12345);
    gameSessions.set(room.id, session);
    room.seats = ['host-user', 'guest-user'];
    room.players.set('guest-user', createCaptureSink(captured));

    expect(await session.startGame(2)).toBe(true);
    await driveCharSelect(session, room);

    const state = session.getState()!;
    // 制造终局:主公死亡 → checkIdentityGameOver 判反贼胜
    const lord = state.players.find((p) => p.identity === '主公')!;
    lord.alive = false;
    lord.health = 0;
    state.seq += 1;
    state.onStateChange?.(); // → broadcastNewState + checkGameOver → handleGameOver → 记录历史

    await sleep(600); // 等 fire-and-forget 落盘

    const entries = await listGameHistory(roomId);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.roomName).toBe('历史测试房');
    expect(entry.winnerLabel).toBe('反贼');
    expect(entry.hasReplay).toBe(true);
    expect(entry.players.find((p) => p.identity === '主公')!.won).toBe(false);
    expect(entry.players.find((p) => p.identity === '反贼')!.won).toBe(true);
    // 座次 → playerId 映射:条目含真实连接身份
    expect(entry.players.some((p) => p.playerId.startsWith('host-') || p.playerId.startsWith('guest-'))).toBe(true);

    const replay = await getGameReplay(roomId, entry.id);
    expect(replay).not.toBeNull();
    expect(isReplayFile(replay!)).toBe(true);
    // 全座次 + 旁观座次(-1):旁观 delta 无私有手牌,供视角受限的重放使用
    const seats = availableSeats(replay!);
    expect(seats).toEqual([-1, 0, 1]);
    expect(replay!.seats[-1]!.privateHands).toHaveLength(0);
    // 回放引擎可重建 initialView(step=0):武将名已就绪
    const v0 = getViewAt(replay!, 0, 0);
    expect(v0).not.toBeNull();
    expect(v0!.players.every((p) => p.character)).toBe(true);
    expect(totalSteps(replay!.seats[0])).toBeGreaterThan(0);

    await clearGameHistory(roomId);
    await session.destroy();
    deleteRoom(room.id);
    gameSessions.delete(room.id);
  }, 30000);

  it('全员掉线宽限超时:记录中断历史(reason=中断,无胜负)', async () => {
    const captured: unknown[] = [];
    const room = createRoom('断线测试房', 2, 'host-user', createCaptureSink(captured));
    const roomId = room.id;
    const session = new GameSession(room, false, 999);
    gameSessions.set(room.id, session);
    room.seats = ['host-user', 'guest-user'];
    room.players.set('guest-user', createCaptureSink(captured));

    expect(await session.startGame(2)).toBe(true);
    await driveCharSelect(session, room);

    // 模拟全员断线:清空连接,触发 handleDisconnect + 宽限计时(RECONNECT_GRACE_MS=30s)
    room.players.delete('host-user');
    room.players.delete('guest-user');
    session.handleDisconnect('host-user');
    session.handleDisconnect('guest-user');
    // 真实 timers 等待宽限超时(31s);fake timers 与上一测试的真实定时器残留冲突,
    // 真实等待虽慢但隔离可靠
    await sleep(31_500);
    await sleep(200); // 让 endDueToDisconnect 的 void appendGameHistory 落盘

    const entries = await listGameHistory(roomId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.endedReason).toBe('中断');
    expect(entries[0]!.winnerLabel).toBe('中断');
    expect(entries[0]!.players.every((p) => p.won === null)).toBe(true);

    await clearGameHistory(roomId);
    gameSessions.delete(room.id);
    deleteRoom(room.id);
  }, 60000);
});
