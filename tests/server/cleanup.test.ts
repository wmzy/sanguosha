// tests/server/cleanup.test.ts
// 回归测试:闲置房间清理(cleanupIdleRooms)。
//
// 核心不变量(Bug 5 修复):**仍有玩家连接的房间永不被清理**。
// 游戏结束后玩家留在房间内等待「再来一局」,此时 lastActivityAt 因 gameOverHandled
// 不再更新(onStateChange 提前返回)。若仅凭 lastActivityAt 判定闲置,连着的玩家会在
// TTL 后被踢出房间。cleanupIdleRooms 必须以 room.players 非空为「保留」信号。
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import { addRoom, getRoom, type Room } from '../../src/server/room';
import { gameSessions, playerRoomMap } from '../../src/server/registry';
import { cleanupIdleRooms, IDLE_ROOM_TTL_MS } from '../../src/server/cleanup';
import type { ServerMessage } from '../../src/server/protocol';

class FakeWS {
  messages: ServerMessage[] = [];
  readyState = 1;
  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }
  close(): void {}
}

function makeRoom(playerIds: string[]): Room {
  const room: Room = {
    id: `cleanup-${Math.random().toString(36).slice(2, 10)}`,
    name: '清理测试',
    maxPlayers: Math.max(playerIds.length, 2),
    players: new Map(),
    status: '已结束',
    hostId: playerIds[0] ?? null,
    readyPlayers: new Set(playerIds),
    isDebug: true,
    config: { name: '清理测试', timeoutScale: 1, charPool: 'all', handSize: 4 },
  } as unknown as Room;
  for (const pid of playerIds) {
    room.players.set(pid, new FakeWS() as never);
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
});
