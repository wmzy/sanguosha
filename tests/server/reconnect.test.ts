// tests/server/reconnect.test.ts
// 服务端 session 断线保活 + 重连座位恢复测试。
// 验证:grace period、playerId 迁移、重连后 action 可用。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession, RECONNECT_GRACE_MS } from '../../src/server/session';
import { addRoom, type Room } from '../../src/server/room';
import { gameSessions } from '../../src/server/registry';
import type { ConnectionSink } from '../../src/server/connection';
import type { ServerMessage } from '../../src/server/protocol';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeMultiplayerRoom(playerIds: string[]): { room: Room; sinks: Map<string, FakeSink> } {
  const sinks = new Map<string, FakeSink>();
  const room: Room = {
    id: `mp-${Math.random().toString(36).slice(2, 8)}`,
    name: '多人重连测试',
    maxPlayers: playerIds.length,
    players: new Map(),
    status: '等待中',
    hostId: playerIds[0],
    readyPlayers: new Set(playerIds),
    config: { name: '多人重连测试', timeoutScale: 1, charPool: 'all', handSize: 4 },
    spectators: new Map(),
    viewGrants: new Map(),
    pendingViewRequests: new Map(),
  } as unknown as Room;
  for (const pid of playerIds) {
    const sink = new FakeSink();
    sinks.set(pid, sink);
    room.players.set(pid, sink);
  }
  addRoom(room);
  return { room, sinks };
}

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

function getState(session: GameSession) {
  return (session as unknown as { state: { seq: number; pendingSlots: Map<unknown, unknown> } })
    .state;
}

function getPlayerNames(session: GameSession): Map<string, number> {
  return (session as unknown as { playerNames: Map<string, number> }).playerNames;
}

function getDisconnectedAt(session: GameSession): Map<string, number> {
  return (session as unknown as { disconnectedAt: Map<string, number> }).disconnectedAt;
}

function getBaselineSent(session: GameSession): Set<string> {
  return (session as unknown as { baselineSent: Set<string> }).baselineSent;
}

describe('RECONNECT_GRACE_MS 常量', () => {
  it('宽限期为 30 秒', () => {
    expect(RECONNECT_GRACE_MS).toBe(30_000);
  });
});

describe('Session 断线保活 (multiplayer)', () => {
  let session: GameSession;
  let room: Room;
  let sinks: Map<string, FakeSink>;

  beforeEach(() => {
    const result = makeMultiplayerRoom(['p1', 'p2']);
    room = result.room;
    sinks = result.sinks;
    session = new GameSession(room, false, 42);
  });

  it('handleDisconnect 记录断线时间并广播 player_disconnected', async () => {
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    // 清除 startGame 期间的消息
    sinks.get('p1')!.messages = [];
    sinks.get('p2')!.messages = [];

    session.handleDisconnect('p1');

    // p1 被标记断线
    const disconnectedAt = getDisconnectedAt(session);
    expect(disconnectedAt.has('p1')).toBe(true);

    // 广播 player_disconnected 给其他玩家
    const p2msgs = sinks.get('p2')!.messages;
    const discMsg = p2msgs.find((m) => m.type === 'player_disconnected');
    expect(discMsg).toBeDefined();
    expect((discMsg as { playerId: string }).playerId).toBe('p1');
  });

  it('部分断线不触发 grace timer(仍有活跃玩家)', async () => {
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    // 只 p1 断线,p2 仍在线
    session.handleDisconnect('p1');

    // graceTimer 不应启动(还有 p2 活跃)
    const graceTimer = (session as unknown as { graceTimer: unknown }).graceTimer;
    expect(graceTimer).toBeNull();
  });

  it('所有玩家断线后启动 grace timer', async () => {
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    session.handleDisconnect('p1');
    // p1 断线后只有 p2 → 不触发
    expect((session as unknown as { graceTimer: unknown }).graceTimer).toBeNull();

    session.handleDisconnect('p2');
    // 所有玩家断线 → 触发 grace timer
    expect((session as unknown as { graceTimer: unknown }).graceTimer).not.toBeNull();
  });

  it('真实 SSE 流程: 先删 room.players 再 handleDisconnect, 仅一人断线不误触发', async () => {
    // sse.ts onAbort 实际调用顺序: room.players.delete(playerId) → session.handleDisconnect(playerId)
    // 旧逻辑用 room.players.size 判断, 一人断线后 size 已减1 → 误判全员断线
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    room.players.delete('p1');
    session.handleDisconnect('p1');

    // p2 仍在线 → 不应触发
    expect((session as unknown as { graceTimer: unknown }).graceTimer).toBeNull();
  });

  it('真实 SSE 流程: 全员断线(room.players 清空)仍触发 grace timer', async () => {
    // 旧 bug: 最后一人断线后 room.players.size=0, allPlayersDisconnected guard 直接 false
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    room.players.delete('p1');
    session.handleDisconnect('p1');
    expect((session as unknown as { graceTimer: unknown }).graceTimer).toBeNull();

    room.players.delete('p2');
    session.handleDisconnect('p2');
    // 所有玩家断线 → 触发 grace timer
    expect((session as unknown as { graceTimer: unknown }).graceTimer).not.toBeNull();
  });
});

describe('Session 重连 playerId 迁移 (multiplayer)', () => {
  let session: GameSession;
  let room: Room;
  let sinks: Map<string, FakeSink>;

  beforeEach(() => {
    const result = makeMultiplayerRoom(['p1', 'p2']);
    room = result.room;
    sinks = result.sinks;
    session = new GameSession(room, false, 42);
  });

  it('reconnectPlayer 迁移旧→新 playerId 的座次映射', async () => {
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    const playerNames = getPlayerNames(session);
    const oldSeat = playerNames.get('p1');
    expect(oldSeat).toBeDefined();

    // 断线
    session.handleDisconnect('p1');

    // 用新 playerId 重连
    const newSink = new FakeSink();
    const result = session.reconnectPlayer('p1-new', newSink, 0, 'p1');

    expect(result).toBe(true);

    // 旧 playerId 被清理
    expect(playerNames.has('p1')).toBe(false);
    expect(getDisconnectedAt(session).has('p1')).toBe(false);

    // 新 playerId 映射到同一座次
    expect(playerNames.get('p1-new')).toBe(oldSeat);
    expect(getBaselineSent(session).has('p1-new')).toBe(true);

    // 新 WS 收到 initialView
    const initMsg = newSink.messages.find((m) => m.type === 'initialView');
    expect(initMsg).toBeDefined();
  });

  it('重连后广播 player_reconnected', async () => {
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    session.handleDisconnect('p1');

    // 清除断线消息
    sinks.get('p2')!.messages = [];

    const newSink = new FakeSink();
    session.reconnectPlayer('p1-new', newSink, 0, 'p1');

    // p2 应收到 player_reconnected
    const p2msgs = sinks.get('p2')!.messages;
    const reconnMsg = p2msgs.find((m) => m.type === 'player_reconnected');
    expect(reconnMsg).toBeDefined();
    expect((reconnMsg as { playerId: string }).playerId).toBe('p1-new');
  });

  it('重连后 session 可通过新 playerId 查到座次(handleAction 不再因 undefined return)', async () => {
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    const playerNames = getPlayerNames(session);
    const p1Seat = playerNames.get('p1')!;

    // 重连前:p1 在映射中,p1-new 不在
    expect(playerNames.has('p1')).toBe(true);
    expect(playerNames.has('p1-new')).toBe(false);

    session.handleDisconnect('p1');
    const newSink = new FakeSink();
    session.reconnectPlayer('p1-new', newSink, 0, 'p1');

    // 重连后:p1 被迁移,p1-new 映射到同一座次
    expect(playerNames.has('p1')).toBe(false);
    expect(playerNames.get('p1-new')).toBe(p1Seat);

    // getPlayerName (公开 API) 也能正确返回
    expect(session.getPlayerName('p1-new')).toBe(p1Seat);
  }, 15000);

  it('旧 playerId 不存在时 reconnectPlayer 返回 false', async () => {
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    const newSink = new FakeSink();
    const result = session.reconnectPlayer('unknown', newSink, 0, 'nonexistent');
    expect(result).toBe(false);
  });

  it('重连清除 grace timer', async () => {
    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    // 所有玩家断线 → grace timer 启动
    session.handleDisconnect('p1');
    session.handleDisconnect('p2');
    expect((session as unknown as { graceTimer: unknown }).graceTimer).not.toBeNull();

    // p1 重连 → grace timer 清除
    const newSink = new FakeSink();
    session.reconnectPlayer('p1-new', newSink, 0, 'p1');
    expect((session as unknown as { graceTimer: unknown }).graceTimer).toBeNull();
  });
});

describe('Session 断线 grace 超时', () => {
  it('grace 超时后广播 gameOver 并销毁 session', async () => {
    const result = makeMultiplayerRoom(['p1', 'p2']);
    const room = result.room;
    const sinks = result.sinks;
    const session = new GameSession(room, false, 42);

    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    // 所有玩家断线
    sinks.get('p1')!.messages = [];
    sinks.get('p2')!.messages = [];
    session.handleDisconnect('p1');
    session.handleDisconnect('p2');

    // grace timer 应已启动
    expect((session as unknown as { graceTimer: unknown }).graceTimer).not.toBeNull();

    // 手动调用 endDueToDisconnect(模拟超时触发)
    (session as unknown as { endDueToDisconnect: () => void }).endDueToDisconnect();

    // 应广播 error + gameOver
    const msgs = sinks.get('p1')!.messages;
    const gameOverMsg = msgs.find((m) => m.type === 'gameOver');
    expect(gameOverMsg).toBeDefined();
    expect((gameOverMsg as { winner: string }).winner).toBe('无人');

    // session 应被标记为 destroyed
    expect((session as unknown as { destroyed: boolean }).destroyed).toBe(true);
  }, 15000);
});

describe('Session 断线 grace 实际超时', () => {
  it('全员断线后 30s grace timer 自动触发 endDueToDisconnect', async () => {
    const result = makeMultiplayerRoom(['p1', 'p2']);
    const room = result.room;
    const sinks = result.sinks;
    const session = new GameSession(room, false, 42);

    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    sinks.get('p1')!.messages = [];
    sinks.get('p2')!.messages = [];

    // 先删 room.players(模拟 SSE onAbort 顺序), 再切 fake timers, 再 handleDisconnect
    room.players.delete('p1');
    room.players.delete('p2');
    vi.useFakeTimers();
    session.handleDisconnect('p1');
    session.handleDisconnect('p2');

    // grace timer 已启动(fake timer)
    expect((session as unknown as { graceTimer: unknown }).graceTimer).not.toBeNull();

    // 推进 29s → 仍未触发
    vi.advanceTimersByTime(29_000);
    expect((session as unknown as { destroyed: boolean }).destroyed).toBe(false);

    // 推进到 30s+ → 触发 endDueToDisconnect
    vi.advanceTimersByTime(1_001);

    // session 已销毁
    expect((session as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect((session as unknown as { graceTimer: unknown }).graceTimer).toBeNull();

    vi.useRealTimers();
  }, 15000);
});

describe('SSE onAbort session 查询时机', () => {
  // 回归测试: sse.ts 的 onAbort 闭包曾在 SSE 连接建立时捕获 session 引用，
  // 但多人房的 GameSession 在 POST /start 时才创建(大厅阶段 gameSessions 为空)。
  // 导致玩家在大厅连接 SSE → 游戏开始 → 全员离线时, onAbort 中的 session 仍为
  // undefined, handleDisconnect 永不调用, grace timer 永不启动。
  // 修复: onAbort 时重新查询 gameSessions.get(roomId)。
  it('session 在游戏开始后才注册到 gameSessions 时, 断线仍能触发 grace timer', async () => {
    const result = makeMultiplayerRoom(['p1', 'p2']);
    const room = result.room;
    const sinks = result.sinks;
    const session = new GameSession(room, false, 42);

    // 模拟大厅阶段: SSE 已连接, 但 session 尚未注册
    expect(gameSessions.get(room.id)).toBeUndefined();

    await session.startGame();
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(100);

    // 模拟 POST /start: session 注册到 gameSessions
    gameSessions.set(room.id, session);

    sinks.get('p1')!.messages = [];
    sinks.get('p2')!.messages = [];

    // 模拟 SSE onAbort(修复后: 从 gameSessions 重新查询)
    room.players.delete('p1');
    room.players.delete('p2');
    vi.useFakeTimers();
    for (const pid of ['p1', 'p2']) {
      const s = gameSessions.get(room.id);
      s?.handleDisconnect(pid);
    }

    // grace timer 已启动
    expect((session as unknown as { graceTimer: unknown }).graceTimer).not.toBeNull();

    vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1);
    expect((session as unknown as { destroyed: boolean }).destroyed).toBe(true);
    vi.useRealTimers();
    gameSessions.delete(room.id);
  }, 15000);
});
