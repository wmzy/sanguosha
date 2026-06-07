// tests/server/game-logger-session.test.ts — GameLogger 集成测试
//
// 验证 GameSession 在以下场景下正确集成 GameLogger：
//   - debug 模式：broadcastEvents 在 events 消息中附带 serverOps
//   - 多人模式：每个玩家收到独立的 playerOps
//   - startGame 生成 gameStart Operation
//   - restoreState 从 serverLog 重建 gameLogger（rebuildFromLog）

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { GameSession } from '../../src/server/session';
import { GameLogger } from '../../src/engine/logger';
import * as persistence from '../../src/server/persistence';
import type { Room } from '../../src/server/room';
import type { GameAction, GameState, Json, ServerEvent } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';
import type { Operation } from '../../src/shared/log';

// ─── helpers ────────────────────────────────────────────────

const room: Room = {
  id: 'gl-test-room',
  name: 'gl-test',
  players: new Map(),
  maxPlayers: 4,
  status: '等待中',
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
  return {
    serverLog: log,
    meta: { status: '进行中' as const },
    playerOrder: [],
    cardMap: {},
    players: {},
  } as unknown as GameState;
}

function setState(session: GameSession, log: ServerEvent[]): void {
  (session as unknown as { state: GameState }).state = fakeGameState(log);
  (session as unknown as { nextSeq: number }).nextSeq = log.length;
}

function getBroadcastEvents(session: GameSession) {
  return (session as unknown as {
    broadcastEvents: (evs: ServerEvent[], action?: GameAction | null) => void;
  }).broadcastEvents;
}

/** 从 events 消息中提取 operations 字段 */
function getOperations(sent: SentMessage[], fromSeq?: number): Operation[] {
  for (const m of sent) {
    if (m.payload.type === 'events') {
      const msg = m.payload;
      if (fromSeq === undefined || msg.fromSeq === fromSeq) {
        return msg.operations ?? [];
      }
    }
  }
  return [];
}

// ─── 测试 ────────────────────────────────────────────────────

describe('GameLogger session 集成', () => {
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

  it('debug 模式：broadcastEvents 在 events 消息中附带 serverOps', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    setState(session, []);

    // 手动注入 gameLogger
    (session as unknown as { gameLogger: GameLogger }).gameLogger =
      new GameLogger(
        { version: '1.0', createdAt: Date.now(), playerCount: 2, characters: ['A', 'B'], seed: 1 },
        ['A', 'B'],
      );

    // 使用 logger 识别的事件类型：setPhase → phaseChange, damage → damage
    getBroadcastEvents(session).call(session, [
      makeEvent('e1', '设阶段', { player: 'A', phase: '摸牌' }),
      makeEvent('e2', '造成伤害', { source: 'A', target: 'B', amount: 1 }),
    ]);

    const ops = getOperations(sent, 1);
    expect(ops.length).toBeGreaterThan(0);
    const types = ops.map((op) => op.type);
    expect(types).toContain('阶段变更');
    expect(types).toContain('造成伤害');
  });

  it('多人模式：每个玩家收到独立的 playerOps', () => {
    const room2: Room = {
      id: 'gl-multi',
      name: 'gl-multi',
      players: new Map(),
      maxPlayers: 4,
      status: '进行中',
      hostId: null,
      readyPlayers: new Set(),
      isDebug: false,
    };

    const p1Sent: SentMessage[] = [];
    const p2Sent: SentMessage[] = [];
    const ws1 = {
      send: vi.fn((data: string) => p1Sent.push({ payload: JSON.parse(data) })),
    };
    const ws2 = {
      send: vi.fn((data: string) => p2Sent.push({ payload: JSON.parse(data) })),
    };
    room2.players.set('pid1', ws1 as never);
    room2.players.set('pid2', ws2 as never);

    const session = new GameSession(room2, false);

    // 设置 state 和 playerNames
    const fakeState = {
      serverLog: [],
      meta: { status: '进行中' as const },
      playerOrder: ['Alice', 'Bob'],
      cardMap: {},
      players: {},
    } as unknown as GameState;
    (session as unknown as { state: GameState }).state = fakeState;
    (session as unknown as { nextSeq: number }).nextSeq = 0;
    (session as unknown as { playerNames: Map<string, string> }).playerNames = new Map([
      ['pid1', 'Alice'],
      ['pid2', 'Bob'],
    ]);

    // 注入 gameLogger
    (session as unknown as { gameLogger: GameLogger }).gameLogger =
      new GameLogger(
        { version: '1.0', createdAt: Date.now(), playerCount: 2, characters: ['Alice', 'Bob'], seed: 1 },
        ['Alice', 'Bob'],
      );

    getBroadcastEvents(session).call(session, [
      makeEvent('e1', '设阶段', { player: 'Alice', phase: '摸牌' }),
      makeEvent('e2', '造成伤害', { source: 'Alice', target: 'Bob', amount: 1 }),
    ]);

    // 每人应该收到各自的 operations
    const p1Ops = getOperations(p1Sent, 1);
    const p2Ops = getOperations(p2Sent, 1);

    // 两人操作数量可能不同（视角裁剪），但都应有内容
    expect(p1Ops.length).toBeGreaterThan(0);
    expect(p2Ops.length).toBeGreaterThan(0);

    // seq 应该各自独立编号
    const p1Seqs = p1Ops.map((op) => op.seq);
    const p2Seqs = p2Ops.map((op) => op.seq);
    expect(p1Seqs).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(p2Seqs).toEqual(expect.arrayContaining([expect.any(Number)]));

    // 清理
    room2.players.clear();
  });

  it('startGame 生成 gameStart Operation', () => {
    const playerId = 'debug-player';
    setupMockWs(playerId);
    const session = new GameSession(room, true, 42);

    session.startGame(2);

    const gameLog = session.getGameLog();
    expect(gameLog).not.toBeNull();

    const serverOps = gameLog!.serverOps;
    const gameStartOps = serverOps.filter((op) => op.type === '游戏开始');
    expect(gameStartOps.length).toBeGreaterThanOrEqual(1);

    // gameStart Operation 的 data 应该存在（当前实现为 {}）
    const gameStartOp = gameStartOps[0];
    expect(gameStartOp.description).toBe('游戏开始');

    // playerOps 中每个玩家也应该有 gameStart
    const playerNames = Object.keys(gameLog!.playerOps);
    expect(playerNames.length).toBe(2);
    for (const pname of playerNames) {
      const pOps = gameLog!.playerOps[pname];
      const pGameStart = pOps.filter((op) => op.type === '游戏开始');
      expect(pGameStart.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('restoreState 从 serverLog 重建 gameLogger（rebuildFromLog）', () => {
    const playerId = 'debug-player';
    setupMockWs(playerId);
    const session = new GameSession(room, true);

    // 使用 logger 识别的事件类型：setPhase → phaseChange, damage → damage
    const fakeLog: ServerEvent[] = [
      makeEvent('e0', '设阶段', { player: 'A', phase: '摸牌' }),
      makeEvent('e1', '造成伤害', { source: 'A', target: 'B', amount: 1 }),
      makeEvent('e2', '击杀', { player: 'B', source: 'A' }),
    ];
    const fakeState = fakeGameState(fakeLog);
    // rebuildFromLog 需要 playerOrder
    (fakeState as { playerOrder: string[] }).playerOrder = ['A', 'B'];

    session.restoreState(fakeState, [{ type: '开始' }]);

    const gameLog = session.getGameLog();
    expect(gameLog).not.toBeNull();

    // serverOps 应该包含从 serverLog 事件重建的操作
    const serverOps = gameLog!.serverOps;
    expect(serverOps.length).toBeGreaterThan(0);

    // playerOps 应该为每个 player 有对应操作
    const playerNames = Object.keys(gameLog!.playerOps);
    expect(playerNames).toContain('A');
    expect(playerNames).toContain('B');
    expect(gameLog!.playerOps['A'].length).toBeGreaterThan(0);
    expect(gameLog!.playerOps['B'].length).toBeGreaterThan(0);

    // 后续 broadcastEvents 应该继续累加 operations
    const serverOpsCountBefore = serverOps.length;
    getBroadcastEvents(session).call(session, [
      makeEvent('e3', '设阶段', { player: 'B', phase: '出牌' }),
    ]);

    const updatedLog = session.getGameLog();
    expect(updatedLog).not.toBeNull();
    expect(updatedLog!.serverOps.length).toBeGreaterThan(serverOpsCountBefore);
  });

  it('无 gameLogger 时 broadcastEvents 不报错（兼容性）', () => {
    const playerId = 'debug-player';
    const { sent } = setupMockWs(playerId);
    const session = new GameSession(room, true);
    setState(session, []);

    // 不注入 gameLogger（gameLogger = null）
    getBroadcastEvents(session).call(session, [makeEvent('x', '设阶段', { player: 'p1', phase: '出牌' })]);

    const eventsMsgs = sent.filter((m) => m.payload.type === 'events');
    expect(eventsMsgs.length).toBe(1);
    const ops = (eventsMsgs[0].payload as Extract<ServerMessage, { type: 'events' }>).operations ?? [];
    expect(ops).toEqual([]);
  });

  it('getGameLog 在无 gameLogger 时返回 null', () => {
    const session = new GameSession(room, true);
    expect(session.getGameLog()).toBeNull();
  });
});
