// tests/server/event-seq.test.ts — 事件序号 + 断点续传
//
// 验证 GameSession 在以下场景下行为正确：
//   - broadcastEvents 给每条事件分配全房间递增的 seq
//   - debugGameState 携带 lastSeq
//   - sendEventsSince(lastSeq) 只补发 serverLog[lastSeq..] 的差量
//   - reconnectPlayer(lastSeq) 决定是补发还是只发快照
//   - 重启后 nextSeq 与持久化 serverLog.length 同步

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { GameSession } from '../../src/server/session';
import * as persistence from '../../src/server/persistence';
import type { Room } from '../../src/server/room';
import type { GameState, Json, ServerEvent } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';

const room: Room = {
  id: 'test-room',
  name: 'test',
  players: new Map(),
  maxPlayers: 4,
  status: '进行中',
  hostId: null,
  readyPlayers: new Set(),
  isDebug: true,
};

interface SentMessage {
  payload: ServerMessage;
}

function setupMockWs(playerId: string): { ws: { send: Mock }; sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  const ws = {
    send: vi.fn((data: string) => {
      const msg = JSON.parse(data) as ServerMessage;
      sent.push({ payload: msg });
    }),
  };
  room.players.set(playerId, ws as never);
  return { ws, sent };
}

function makeEvent(id: string, type: string, payload: Json = {}): ServerEvent {
  return { id, type, timestamp: Date.now(), payload };
}

function fakeGameState(log: ServerEvent[]): GameState {
  // 最小可用的 GameState 形状，broadcastEvents/reconnectPlayer 至少需要：
  // serverLog、meta.status；reconnectPlayer 在 debug 模式下会迭代 playerOrder。
  return {
    serverLog: log,
    meta: { status: '进行中' as const },
    playerOrder: [],
  } as unknown as GameState;
}

function setState(session: GameSession, log: ServerEvent[]): void {
  (session as unknown as { state: GameState }).state = fakeGameState(log);
  (session as unknown as { nextSeq: number }).nextSeq = log.length;
}

function getBroadcastEvents(session: GameSession) {
  return (session as unknown as {
    broadcastEvents: (evs: ServerEvent[]) => void;
  }).broadcastEvents;
}

function getSendEventsSince(session: GameSession) {
  return (session as unknown as {
    sendEventsSince: (pid: string, lastSeq: number) => void;
  }).sendEventsSince;
}

function getSendDebugGameState(session: GameSession) {
  return (session as unknown as {
    sendDebugGameState: (pid: string) => void;
  }).sendDebugGameState;
}

function clearPlayerNames(session: GameSession): void {
  (session as unknown as { playerNames: Map<string, string> }).playerNames = new Map();
}

describe('事件序号 + 断点续传', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(persistence, 'saveRoom').mockImplementation(async () => {});
    vi.spyOn(persistence, 'deletePersistedRoom').mockImplementation(async () => {});
  });

  afterEach(() => {
    room.players.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('broadcastEvents 给每条事件分配从 nextSeq+1 开始的连续 seq', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    setState(session, []);

    getBroadcastEvents(session).call(session, [
      makeEvent('e1', '回合开始'),
      makeEvent('e2', '阶段开始'),
      makeEvent('e3', '摸牌'),
    ]);

    const eventsMsg = sent.find((s) => s.payload.type === 'events')?.payload as
      | Extract<ServerMessage, { type: 'events' }>
      | undefined;
    expect(eventsMsg).toBeDefined();
    expect(eventsMsg!.events).toHaveLength(3);
    expect(eventsMsg!.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(eventsMsg!.fromSeq).toBe(1);
  });

  it('多次 broadcastEvents 之间 seq 连续递增，不重置', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    setState(session, []);

    getBroadcastEvents(session).call(session, [makeEvent('a', '回合开始'), makeEvent('b', '阶段开始')]);
    getBroadcastEvents(session).call(session, [makeEvent('c', '摸牌')]);
    getBroadcastEvents(session).call(session, [makeEvent('d', '造成伤害'), makeEvent('e', '击杀')]);

    const allSeqs: number[] = [];
    for (const m of sent) {
      if (m.payload.type === 'events') {
        for (const e of m.payload.events) allSeqs.push(e.seq);
      }
    }
    expect(allSeqs).toEqual([1, 2, 3, 4, 5]);
  });

  it('debugGameState 消息携带 lastSeq', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    setState(session, Array.from({ length: 7 }, (_, i) => makeEvent(`e${i}`, 'noop')));
    // setState 已设置 nextSeq=7

    getSendDebugGameState(session).call(session, playerId);

    const dgs = sent.find((s) => s.payload.type === 'debugGameState')?.payload as
      | Extract<ServerMessage, { type: 'debugGameState' }>
      | undefined;
    expect(dgs).toBeDefined();
    expect(dgs!.lastSeq).toBe(7);
  });

  it('events 消息不再携带 actionLog 字段', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    setState(session, []);

    getBroadcastEvents(session).call(session, [makeEvent('x', '回合开始')]);

    const eventsMsg = sent.find((s) => s.payload.type === 'events')?.payload as
      | { actionLog?: unknown }
      | undefined;
    expect(eventsMsg).toBeDefined();
    expect(eventsMsg!.actionLog).toBeUndefined();
  });

  it('sendEventsSince(lastSeq=0) 重发整段 serverLog，seq 从 1 开始', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    const fakeLog: ServerEvent[] = [
      makeEvent('e0', '回合开始'),
      makeEvent('e1', '阶段开始'),
      makeEvent('e2', '摸牌'),
      makeEvent('e3', '造成伤害'),
      makeEvent('e4', '击杀'),
    ];
    setState(session, fakeLog);

    getSendEventsSince(session).call(session, playerId, 0);

    const eventsMsg = sent.find((s) => s.payload.type === 'events')?.payload as
      | Extract<ServerMessage, { type: 'events' }>
      | undefined;
    expect(eventsMsg).toBeDefined();
    expect(eventsMsg!.events).toHaveLength(5);
    expect(eventsMsg!.fromSeq).toBe(1);
    expect(eventsMsg!.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('sendEventsSince(lastSeq=N) 只补发 serverLog[N..]，fromSeq=N+1', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    const fakeLog: ServerEvent[] = Array.from({ length: 5 }, (_, i) => makeEvent(`e${i}`, 'noop'));
    setState(session, fakeLog);

    getSendEventsSince(session).call(session, playerId, 2);

    const eventsMsg = sent.find((s) => s.payload.type === 'events')?.payload as
      | Extract<ServerMessage, { type: 'events' }>
      | undefined;
    expect(eventsMsg).toBeDefined();
    expect(eventsMsg!.events).toHaveLength(3);
    expect(eventsMsg!.fromSeq).toBe(3);
    expect(eventsMsg!.events.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('sendEventsSince(lastSeq>=log.length) 发空 events 让客户端明确无新事件', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    setState(session, [makeEvent('e0', 'noop')]);

    getSendEventsSince(session).call(session, playerId, 999);

    const eventsMsg = sent.find((s) => s.payload.type === 'events')?.payload as
      | Extract<ServerMessage, { type: 'events' }>
      | undefined;
    expect(eventsMsg).toBeDefined();
    expect(eventsMsg!.events).toHaveLength(0);
    expect(eventsMsg!.fromSeq).toBe(999);
  });

  it('reconnectPlayer(lastSeq=0) 发快照 + 全量续传', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    setState(session, [makeEvent('e0', 'noop'), makeEvent('e1', 'noop')]);
    clearPlayerNames(session);

    const result = session.reconnectPlayer(playerId, room.players.get(playerId) as never, 0);
    expect(result).toBe(true);

    const debugs = sent.filter((s) => s.payload.type === 'debugGameState');
    const events = sent.filter((s) => s.payload.type === 'events');
    expect(debugs).toHaveLength(1);
    expect(events).toHaveLength(1);
    const eventsMsg = events[0].payload as Extract<ServerMessage, { type: 'events' }>;
    expect(eventsMsg.events).toHaveLength(2);
  });

  it('reconnectPlayer(lastSeq=current lastSeq) 只发快照，不发续传', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    setState(session, [makeEvent('e0', 'noop'), makeEvent('e1', 'noop')]);
    clearPlayerNames(session);

    const result = session.reconnectPlayer(playerId, room.players.get(playerId) as never, 2);
    expect(result).toBe(true);

    const events = sent.filter((s) => s.payload.type === 'events');
    expect(events).toHaveLength(0);
  });

  it('reconnectPlayer(lastSeq=中间值) 跳过已发事件', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    const fakeLog: ServerEvent[] = [
      makeEvent('e0', 'a'),
      makeEvent('e1', 'b'),
      makeEvent('e2', 'c'),
      makeEvent('e3', 'd'),
      makeEvent('e4', 'e'),
    ];
    setState(session, fakeLog);
    clearPlayerNames(session);

    const result = session.reconnectPlayer(playerId, room.players.get(playerId) as never, 2);
    expect(result).toBe(true);

    const eventsMsg = sent.find((s) => s.payload.type === 'events')?.payload as
      | Extract<ServerMessage, { type: 'events' }>
      | undefined;
    expect(eventsMsg).toBeDefined();
    expect(eventsMsg!.events).toHaveLength(3);
    expect(eventsMsg!.events.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('restoreState 同步 nextSeq = serverLog.length', () => {
    const session = new GameSession(room, true);
    const fakeLog: ServerEvent[] = [
      makeEvent('e0', 'a'),
      makeEvent('e1', 'b'),
      makeEvent('e2', 'c'),
    ];
    session.restoreState(fakeGameState(fakeLog), []);

    const stateAny = session as unknown as { nextSeq: number };
    expect(stateAny.nextSeq).toBe(3);
  });

  it('重启后 nextSeq 从 serverLog.length 重建，新事件 seq 不会与持久化事件冲突', () => {
    // 第一阶段：构造一个有 serverLog 的 session
    const session1 = new GameSession(room, true);
    const fakeLog: ServerEvent[] = [
      makeEvent('e0', 'a'),
      makeEvent('e1', 'b'),
    ];
    session1.restoreState(fakeGameState(fakeLog), []);
    expect((session1 as unknown as { nextSeq: number }).nextSeq).toBe(2);

    // 第二阶段：模拟"重启后"——新 session 重新 restore 同样的 serverLog
    const session2 = new GameSession(room, true);
    session2.restoreState(fakeGameState(fakeLog), []);

    // 第三阶段：新事件再 broadcast，seq 应从 3 开始
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    getBroadcastEvents(session2).call(session2, [makeEvent('new', '回合开始')]);

    const eventsMsg = sent.find((s) => s.payload.type === 'events')?.payload as
      | Extract<ServerMessage, { type: 'events' }>
      | undefined;
    expect(eventsMsg).toBeDefined();
    expect(eventsMsg!.events[0].seq).toBe(3);
    expect(eventsMsg!.fromSeq).toBe(3);
  });
});
