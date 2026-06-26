import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import { joinDebugRoom, createDebugRoom, addRoom, type Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';

function makeRoom(): Room {
  return {
    id: 'test-' + Math.random().toString(36).slice(2, 8),
    name: '测试', maxPlayers: 4, players: new Map(),
    isDebug: true, createdAt: Date.now(), status: '进行中',
    config: { name: '测试', timeoutScale: 1, charPool: 'all', handSize: 4 },
  } as unknown as Room;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}

describe('全局 CAS 删除', () => {
  let session: GameSession;
  beforeEach(() => { resetForTest(); session = new GameSession(makeRoom(), true, 42); });

  it('陈旧 baseSeq 的主动 action 不再被 CAS 拒绝', async () => {
    await session.startGame(4);
    const state = getState(session);
    // 等选将完成
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);
    const lordSlot = [...state.pendingSlots.values()][0].atom as { target: number; candidates: Array<{ name: string }> };
    await session.handleAction('p0', {
      skillId: '系统规则', actionType: '选将', ownerId: lordSlot.target,
      params: { character: lordSlot.candidates[0].name }, baseSeq: state.seq,
    });
    for (let i = 0; i < 100 && state.pendingSlots.size !== 3; i++) await sleep(10);
    const others = [...state.pendingSlots.keys()];
    for (const t of others) {
      const slot = state.pendingSlots.get(t)!;
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates[0];
      await session.handleAction('p' + t, {
        skillId: '系统规则', actionType: '选将', ownerId: t,
        params: { character: cand.name }, baseSeq: state.seq,
      });
      await sleep(50);
    }
    for (let i = 0; i < 200 && state.pendingSlots.size > 0; i++) await sleep(10);

    // 等待进入 player 0 的出牌阶段(bootstrap 完成后回合管理自动推进到出牌)
    for (let i = 0; i < 300 && (state.currentPlayerIndex !== 0 || state.phase !== '出牌' || state.pendingSlots.size > 0); i++) await sleep(10);

    // 用陈旧 baseSeq 发主动 action——不应被 CAS 拒(CAS 已删)
    const veryStaleSeq = state.seq - 10;
    const seqBefore = state.seq;
    await session.handleAction('p0', {
      skillId: '回合管理', actionType: 'end', ownerId: 0,
      params: {}, baseSeq: veryStaleSeq,
    });
    await sleep(200);
    // CAS 删除后：action 被接受 → seq 推进
    expect(state.seq).toBeGreaterThan(seqBefore);
  }, 15000);
});

class FakeWS {
  messages: ServerMessage[] = [];
  send(data: string) { this.messages.push(JSON.parse(data)); }
  readyState = 1; // OPEN
}

describe('重连 initialView', () => {
  let session: GameSession;
  beforeEach(() => { resetForTest(); session = new GameSession(makeRoom(), true, 42); });

  it('reconnectPlayer 发 initialView 且同步 lastBroadcastSeq', async () => {
    await session.startGame(2);
    const state = getState(session);
    // 等选将完成 + 游戏进行中
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(200);

    const seqAtReconnect = state.seq;
    const fakeWs = new FakeWS();
    (session as any).playerNames.set('p0', 0);
    session.reconnectPlayer('p0', fakeWs as any, 0);

    // 应收到 initialView（全量状态）
    const initMsg = fakeWs.messages.find(m => m.type === 'initialView');
    expect(initMsg).toBeDefined();
    // 不应收到 event 差量——initialView 已含全量状态
    const eventMsg = fakeWs.messages.find(m => m.type === 'event');
    expect(eventMsg).toBeUndefined();
    // lastBroadcastSeq 应已同步到 state.seq
    const lb = (session as any).lastBroadcastSeq as number;
    expect(lb).toBeGreaterThanOrEqual(seqAtReconnect);
  }, 15000);
});

describe('pending 倒计时下发', () => {
  let session: GameSession;
  beforeEach(() => { resetForTest(); session = new GameSession(makeRoom(), true, 42); });

  it('event 消息携带 deadline(pending 的 deadline/totalMs)', async () => {
    await session.startGame(2);
    const state = getState(session);
    // 等选将 pending 出现
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    const fakeWs = new FakeWS();
    (session as any).playerNames.set('p0', 0);
    // 注册 WS 到 room
    const room = (session as any).room as Room;
    room.players.set('p0', fakeWs as any);
    // 重置 lastBroadcastSeq 强制重发已有事件（startGame 期间 broadcastNewState 已推进过水位）
    (session as any).lastBroadcastSeq = 0;
    // 重置 deadline 缓存,确保 pending deadline 被发送
    (session as any).lastSentDeadline = new Map();
    // 触发一次广播
    (session as any).broadcastNewState();

    // initialView 应该已发送(且其 pending 含 deadline)
    const initMsg = fakeWs.messages.find(m => m.type === 'initialView') as Extract<ServerMessage, { type: 'initialView' }> | undefined;
    expect(initMsg).toBeDefined();
    // initialView 的 pending 含 deadline(totalMs=60s)
    expect(initMsg!.state.pending).not.toBeNull();
    expect(initMsg!.state.pending!.deadline).toBeTypeOf('number');
    expect(initMsg!.state.pending!.totalMs).toBe(60_000);
    // deadline 应为绝对 epoch 时间戳
    expect(initMsg!.state.pending!.deadline).toBeGreaterThan(Date.now());
    // 也应有 event 消息(view 事件)
    const eventMsg = fakeWs.messages.find(m => m.type === 'event');
    expect(eventMsg).toBeDefined();
  }, 15000);
});

describe('debug 房间刷新重连', () => {
  let session: GameSession;
  let room: Room;
  beforeEach(() => {
    resetForTest();
    room = createDebugRoom('测试刷新', 2);
    addRoom(room);
    session = new GameSession(room, true, 42);
  });

  it('满员时 joinDebugRoom 复用最早座次并返回被替换的 playerId', async () => {
    await session.startGame(2);
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(200);

    // 初始两个连接占满 2 个座次
    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    const r1 = joinDebugRoom(room.id, 'p1', ws1 as never);
    const r2 = joinDebugRoom(room.id, 'p2', ws2 as never);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    session.assignDebugSeat('p1');
    session.assignDebugSeat('p2');
    expect(room.players.size).toBe(2);

    // 模拟刷新:房间已满,第三个连接应复用 p1 的座次
    const ws3 = new FakeWS();
    const r3 = joinDebugRoom(room.id, 'p3', ws3 as never);
    expect(r3).not.toBeNull();
    expect(r3!.replacedPlayerId).toBe('p1');
    // 旧连接被弱踢出
    expect(room.players.has('p1')).toBe(false);
    expect(room.players.has('p3')).toBe(true);
    expect(room.players.size).toBe(2);
  }, 15000);

  it('evictDebugPlayer 清理旧 playerId 映射,新连接重新分配同一座次', async () => {
    await session.startGame(2);
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(200);

    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    joinDebugRoom(room.id, 'p1', ws1 as never);
    joinDebugRoom(room.id, 'p2', ws2 as never);
    const seat1 = session.assignDebugSeat('p1');
    const seat2 = session.assignDebugSeat('p2');
    expect(seat1).toBe(0);
    expect(seat2).toBe(1);

    // 模拟刷新重连:p1 被替换 → evictDebugPlayer 清理 → p3 接管座次 0
    const ws3 = new FakeWS();
    const r3 = joinDebugRoom(room.id, 'p3', ws3 as never);
    expect(r3!.replacedPlayerId).toBe('p1');
    session.evictDebugPlayer('p1');
    const seat3 = session.assignDebugSeat('p3');
    expect(seat3).toBe(0); // 复用被释放的座次 0

    // p3 重连后能收到 initialView
    session.reconnectPlayer('p3', ws3 as never, 0);
    const initMsg = ws3.messages.find(m => m.type === 'initialView');
    expect(initMsg).toBeDefined();
  }, 15000);
});
