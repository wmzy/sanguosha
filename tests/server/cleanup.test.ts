// tests/server/cleanup.test.ts
// 回归测试:闲置房间清理(cleanupIdleRooms)。
//
// 核心不变量(Bug 5 修复):**仍有玩家连接的房间永不被清理**。
// 游戏结束后玩家留在房间内等待「再来一局」,此时 lastActivityAt 因 gameOverHandled
// 不再更新(onStateChange 提前返回)。若仅凭 lastActivityAt 判定闲置,连着的玩家会在
// TTL 后被踢出房间。cleanupIdleRooms 必须以 room.players 非空为「保留」信号。
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms';
import { GameSession } from '../../src/server/session';
import { addRoom, deleteRoom, getAllRooms, getRoom, type Room } from '../../src/server/room';
import { gameSessions, playerRoomMap } from '../../src/server/registry';
import { cleanupIdleRooms, cleanupDisconnectedRooms, IDLE_ROOM_TTL_MS } from '../../src/server/cleanup';
import { downgradeStaleNormalRooms } from '../../src/server/app';
import type { ServerMessage } from '../../src/server/protocol';
import type { ConnectionSink } from '../../src/server/connection';

class FakeSink implements ConnectionSink {
  messages: ServerMessage[] = [];
  send(message: ServerMessage): void {
    this.messages.push(message);
  }

  close(): void {}
  get isAlive(): boolean {
    return true;
  }
}

function makeRoom(playerIds: string[], roomType: 'normal' | 'quick' = 'quick'): Room {
  const room: Room = {
    id: `cleanup-${Math.random().toString(36).slice(2, 10)}`,
    name: '清理测试',
    maxPlayers: Math.max(playerIds.length, 2),
    players: new Map(),
    status: '已结束',
    hostId: playerIds[0] ?? null,
    readyPlayers: new Set(playerIds),
    roomType,
    isDebug: true,
    config: { name: '清理测试', timeoutSec: 30, charPool: 'all', handSize: 4 },
    spectators: new Map(),
    viewGrants: new Map(),
    pendingViewRequests: new Map(),
    chatUsage: new Map(),
    chatHistory: [],
    seats: Array(Math.max(playerIds.length, 2)).fill(null),
    pendingSeatSwaps: new Map(),
    playerNames: new Map(playerIds.map((pid, i) => [pid, `玩家${i + 1}`])),
  } as unknown as Room;
  for (const pid of playerIds) {
    room.players.set(pid, new FakeSink());
  }
  addRoom(room);
  return room;
}

/** 一个足够大的「未来」时间戳,使任何刚创建 session 的 lastActivityAt 都判定为超时。 */
function futureNow(): number {
  return Date.now() + IDLE_ROOM_TTL_MS + 1;
}

describe('cleanupIdleRooms', () => {
  beforeEach(() => {
    gameSessions.clear();
    playerRoomMap.clear();
  });

  it('仍有玩家连接的房间不被清理(游戏结束后玩家留在房间)', () => {
    const room = makeRoom(['p1', 'p2']);
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);

    const cleaned = cleanupIdleRooms(futureNow());

    expect(cleaned).not.toContain(room.id);
    expect(gameSessions.has(room.id)).toBe(true);
    expect(getRoom(room.id)).not.toBeNull();
    // 玩家仍在房间内
    expect(getRoom(room.id)!.players.size).toBe(2);
  });

  it('无玩家连接的空房间超过 TTL 被回收', () => {
    const room = makeRoom([]); // 无人连接
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);

    const cleaned = cleanupIdleRooms(futureNow());

    expect(cleaned).toContain(room.id);
    expect(gameSessions.has(room.id)).toBe(false);
    expect(getRoom(room.id)).toBeNull();
  });

  it('有玩家连接但未超 TTL 的房间保留', () => {
    const room = makeRoom(['p1']);
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);

    // now = 当前时间,session 刚创建,lastActivityAt ≈ now,未超时
    const cleaned = cleanupIdleRooms();

    expect(cleaned).not.toContain(room.id);
    expect(gameSessions.has(room.id)).toBe(true);
  });

  it('已 destroy 的 zombie session 立即回收(无视 TTL 与残留 players)', async () => {
    // 模拟全员断线 grace 超时:endDueToDisconnect 会 destroy 但不清 room.players。
    // 若仅看 players.size,zombie 会永久泄漏——必须靠 isDestroyed 兜底。
    const room = makeRoom(['p1', 'p2']);
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);
    await session.destroy();
    // destroy 后 room.players 仍有(已断线的)记录,模拟 endDueToDisconnect 遗留
    expect(room.players.size).toBe(2);

    const cleaned = cleanupIdleRooms(); // 即使 now=现在(未超 TTL)也回收

    expect(cleaned).toContain(room.id);
    expect(gameSessions.has(room.id)).toBe(false);
    expect(getRoom(room.id)).toBeNull();
  });

  it('清理时移除玩家的 playerRoomMap 映射', () => {
    const room = makeRoom([]);
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);
    playerRoomMap.set('lonely', room.id);

    cleanupIdleRooms(futureNow());

    expect(playerRoomMap.has('lonely')).toBe(false);
  });

  it('普通房间(normal)不被闲置清理', () => {
    const room = makeRoom([], 'normal');
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);

    const cleaned = cleanupIdleRooms(futureNow());

    expect(cleaned).not.toContain(room.id);
    expect(getRoom(room.id)).not.toBeNull();
    expect(gameSessions.has(room.id)).toBe(true);
  });

  it('普通房间即使超 TTL 且无玩家也保留', () => {
    const room = makeRoom([], 'normal');
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);
    playerRoomMap.set('normal-player', room.id);

    cleanupIdleRooms(futureNow());

    expect(getRoom(room.id)).not.toBeNull();
    expect(playerRoomMap.has('normal-player')).toBe(true);
  });

  it('普通房间 zombie session 仅移除 session,保留 room/玩家映射(回归)', async () => {
    // 回归:普通房间 session 被 destroy(如全员断线 grace 超时)后,zombie
    // session 不能触发 deleteRoom/deletePersistedRoom/deleteRoomFromDb,
    // 否则普通房间「持久保留」契约被破坏。
    const room = makeRoom(['p1', 'p2'], 'normal');
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);
    playerRoomMap.set('p1', room.id);
    playerRoomMap.set('p2', room.id);
    await session.destroy();
    // 模拟 endDueToDisconnect 遗留:room.players 仍有(已断线的)记录
    expect(room.players.size).toBe(2);

    const cleaned = cleanupIdleRooms(); // 即使 now=现在(未超 TTL)

    // 普通房间不在「被清理」结果中(结果专用于快速房间的完整回收)
    expect(cleaned).not.toContain(room.id);
    // session 对象从 gameSessions 移除,避免泄漏
    expect(gameSessions.has(room.id)).toBe(false);
    // room / playerRoomMap 必须完整保留,房主可重连或显式删房间
    expect(getRoom(room.id)).not.toBeNull();
    expect(getRoom(room.id)!.players.size).toBe(2);
    expect(playerRoomMap.has('p1')).toBe(true);
    expect(playerRoomMap.has('p2')).toBe(true);
  });
});

// 回归:普通房间「不自动销毁」契约。
// 原Bug: restoreNormalRoomsFromDb 启动恢复时按 1 小时过期删除非「进行中」的普通房间,
// 导致等待中/已结束的普通房间在服务器重启后被销毁。修复后普通房间无论多旧都从 DB 恢复。
// downgradeStaleNormalRooms 负责将无 session 的普通房间降级为等待中(含已结束状态),
// 确保房主始终能在房间列表看到房间。
describe('downgradeStaleNormalRooms — 普通房间不自动销毁', () => {
  beforeEach(() => {
    gameSessions.clear();
    playerRoomMap.clear();
  });

  it('已结束且无 session 的普通房间降级为等待中', async () => {
    const room = makeRoom([], 'normal');
    room.status = '已结束';

    await downgradeStaleNormalRooms();

    expect(getRoom(room.id)).not.toBeNull();
    expect(getRoom(room.id)!.status).toBe('等待中');
    expect(getRoom(room.id)!.seats.every((s) => s === null)).toBe(true);
  });

  it('进行中且无 session 的普通房间降级为等待中', async () => {
    const room = makeRoom([], 'normal');
    room.status = '进行中';

    await downgradeStaleNormalRooms();

    expect(getRoom(room.id)!.status).toBe('等待中');
  });

  it('等待中的普通房间保持不变', async () => {
    const room = makeRoom([], 'normal');
    room.status = '等待中';

    await downgradeStaleNormalRooms();

    expect(getRoom(room.id)!.status).toBe('等待中');
  });

  it('有活跃 session 的进行中普通房间不降级', async () => {
    const room = makeRoom(['p1', 'p2'], 'normal');
    room.status = '进行中';
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);

    await downgradeStaleNormalRooms();

    expect(getRoom(room.id)!.status).toBe('进行中');
  });

  it('快速房间不受降级影响', async () => {
    const room = makeRoom([], 'quick');
    room.status = '已结束';

    await downgradeStaleNormalRooms();

    expect(getRoom(room.id)!.status).toBe('已结束');
  });
});

// 回归:无连接快速/debug 房间回收(cleanupDisconnectedRooms)。
// 原Bug: cleanupIdleRooms 只遍历 gameSessions,「等待中且未开局」的 debug 房间
// 没有 session,永远不会被清理——dev server 运行数日后积累 44+ 死房间(玩家数 0)。
// 修复:直接扫描 roomList,以「players + spectators 全空」为无连接信号,持续超过
// TTL(默认 60s)即完全销毁,不论等待中/进行中;normal 房间不受影响。
describe('cleanupDisconnectedRooms — 无连接快速房间回收', () => {
  const TTL = 1_000; // 注入短 TTL
  let t0: number;

  beforeEach(() => {
    gameSessions.clear();
    playerRoomMap.clear();
    // 清空全局 roomList,保证用例间互不干扰(本 describe 私有)
    for (const r of getAllRooms()) deleteRoom(r.id);
    t0 = Date.now();
  });

  it('debug 房无 SSE 连接持续 TTL 后销毁(等待中,无 session)', () => {
    const room = makeRoom([]); // quick + isDebug,无连接
    room.status = '等待中'; // 模拟 POST /api/debug-room 后从未有连接

    // 首次扫描:仅记录计时起点,不销毁
    expect(cleanupDisconnectedRooms(t0, TTL)).not.toContain(room.id);
    expect(getRoom(room.id)).not.toBeNull();

    // TTL 内:不销毁
    expect(cleanupDisconnectedRooms(t0 + TTL - 1, TTL)).not.toContain(room.id);
    expect(getRoom(room.id)).not.toBeNull();

    // 达到 TTL:销毁,GET /api/rooms/:id 将 404
    expect(cleanupDisconnectedRooms(t0 + TTL, TTL)).toContain(room.id);
    expect(getRoom(room.id)).toBeNull();
  });

  it('有 SSE 连接时不销毁(玩家在房间)', () => {
    const room = makeRoom(['p1', 'p2']);
    room.status = '等待中';

    expect(cleanupDisconnectedRooms(t0, TTL)).not.toContain(room.id);
    // 远超 TTL 的时间点再扫:只要仍有连接就保留
    expect(cleanupDisconnectedRooms(t0 + TTL * 10, TTL)).not.toContain(room.id);
    expect(getRoom(room.id)).not.toBeNull();
    expect(getRoom(room.id)!.players.size).toBe(2);
  });

  it('有旁观者连接时同样不销毁', () => {
    const room = makeRoom([]);
    room.status = '等待中';
    room.spectators.set('spec-1', new FakeSink());

    expect(cleanupDisconnectedRooms(t0 + TTL * 10, TTL)).not.toContain(room.id);
    expect(getRoom(room.id)).not.toBeNull();
  });

  // 回归:REST join 注册的 nullSink(isAlive=false)占位不算连接。
  // 原Bug: 脚本/客户端 REST join 后从未开流(或单活流模式下非当前视角座次),
  // players 里永远留着一个 nullSink 条目,「players 非空」恒真,
  // 无连接回收永不触发——实测 dev server 积累 12+ 个 1 人僵尸 debug 房。
  it('仅含 nullSink 占位的房间视为无连接,超 TTL 销毁', () => {
    const room = makeRoom([]);
    room.status = '等待中';
    room.players.set('ghost', { send: () => {}, close: () => {}, isAlive: false });

    // 首次扫描:记录起点
    expect(cleanupDisconnectedRooms(t0, TTL)).not.toContain(room.id);
    // 达到 TTL:销毁
    expect(cleanupDisconnectedRooms(t0 + TTL, TTL)).toContain(room.id);
    expect(getRoom(room.id)).toBeNull();
  });

  it('nullSink 与真实连接并存时不销毁(真实连接保命)', () => {
    const room = makeRoom(['p1']);
    room.status = '等待中';
    room.players.set('ghost', { send: () => {}, close: () => {}, isAlive: false });

    expect(cleanupDisconnectedRooms(t0 + TTL * 10, TTL)).not.toContain(room.id);
    expect(getRoom(room.id)).not.toBeNull();
  });

  it('计时中重连会清零:重新断开后重新计满 TTL 才销毁', () => {
    const room = makeRoom([]);
    room.status = '等待中';

    cleanupDisconnectedRooms(t0, TTL); // 记录起点

    // 玩家重连 → 计时清零
    const sink = new FakeSink();
    room.players.set('p1', sink);
    expect(cleanupDisconnectedRooms(t0 + TTL * 2, TTL)).not.toContain(room.id);

    // 再次断开,从新起点重新计时
    room.players.delete('p1');
    expect(cleanupDisconnectedRooms(t0 + TTL * 3, TTL)).not.toContain(room.id); // 新起点刚记录
    expect(cleanupDisconnectedRooms(t0 + TTL * 3 + TTL, TTL)).toContain(room.id); // 计满
    expect(getRoom(room.id)).toBeNull();
  });

  it('进行中的无连接房间同样销毁,且 session 被释放', () => {
    const room = makeRoom([]);
    room.status = '进行中';
    const session = new GameSession(room, true, 42);
    gameSessions.set(room.id, session);

    expect(cleanupDisconnectedRooms(t0, TTL)).not.toContain(room.id);
    expect(cleanupDisconnectedRooms(t0 + TTL, TTL)).toContain(room.id);

    // 走 destroyRoomCompletely:session 从 gameSessions 移除,room 删除
    expect(gameSessions.has(room.id)).toBe(false);
    expect(getRoom(room.id)).toBeNull();
  });

  it('normal 房间不受无连接回收影响(即使远超 TTL)', () => {
    const room = makeRoom([], 'normal');
    room.status = '等待中';

    expect(cleanupDisconnectedRooms(t0, TTL)).not.toContain(room.id);
    expect(cleanupDisconnectedRooms(t0 + TTL * 100, TTL)).not.toContain(room.id);
    expect(getRoom(room.id)).not.toBeNull();
  });
});
