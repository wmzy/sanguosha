// tests/server/reconnect.test.ts
// 服务端 session 断线保活 + 重连座位恢复测试。
// 验证:grace period、playerId 迁移、重连后 action 可用。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession, RECONNECT_GRACE_MS } from '../../src/server/session';
import { addRoom, type Room } from '../../src/server/room';
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
  it('宽限期为 60 秒', () => {
    expect(RECONNECT_GRACE_MS).toBe(60_000);
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
