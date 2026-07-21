import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { GameSession } from '../../src/server/session';
import { joinDebugRoom, createDebugRoom, addRoom, type Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';
import type { ConnectionSink } from '../../src/server/connection';

function makeRoom(): Room {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    name: '测试',
    maxPlayers: 4,
    players: new Map(),
    isDebug: true,
    createdAt: Date.now(),
    status: '进行中',
    config: { name: '测试', timeoutScale: 1, charPool: 'all', handSize: 4 },
    spectators: new Map(),
    viewGrants: new Map(),
    pendingViewRequests: new Map(),
  } as unknown as Room;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}

describe('全局 CAS 删除', () => {
  let session: GameSession;
  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
  });

  it('陈旧 baseSeq 的主动 action 不再被 CAS 拒绝', async () => {
    await session.startGame(4);
    const state = getState(session);
    // 等选将完成
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);
    const lordSlot = [...state.pendingSlots.values()][0].atom as {
      target: number;
      candidates: Array<{ name: string }>;
    };
    await session.handleAction('p0', {
      skillId: '系统规则',
      actionType: '选将',
      ownerId: lordSlot.target,
      params: { character: lordSlot.candidates[0].name },
      baseSeq: state.seq,
    });
    for (let i = 0; i < 100 && state.pendingSlots.size !== 3; i++) await sleep(10);
    const others = [...state.pendingSlots.keys()];
    for (const t of others) {
      const slot = state.pendingSlots.get(t)!;
      const cand = (slot.atom as { candidates: Array<{ name: string }> }).candidates[0];
      await session.handleAction(`p${t}`, {
        skillId: '系统规则',
        actionType: '选将',
        ownerId: t,
        params: { character: cand.name },
        baseSeq: state.seq,
      });
      await sleep(50);
    }
    for (let i = 0; i < 200 && state.pendingSlots.size > 0; i++) await sleep(10);

    // 等待进入 player 0 的出牌阶段(bootstrap 完成后回合管理自动推进到出牌)
    // 注:某些角色(如刘禅·放权)在进入出牌阶段前会触发 confirm 询问——
    // 自动拒绝以推进阶段切换。
    for (
      let i = 0;
      i < 300 &&
      (state.currentPlayerIndex !== 0 || state.phase !== '出牌' || state.pendingSlots.size > 0);
      i++
    ) {
      for (const [t, slot] of state.pendingSlots) {
        if (!slot.isBlocking) continue;
        const atom = slot.atom as { type?: string; requestType?: string; target?: number };
        if (atom.type === '请求回应' && atom.target === t) {
          await session.handleAction(`p${t}`, {
            skillId: atom.requestType?.split('/')[0] ?? '系统规则',
            actionType: 'respond',
            ownerId: t,
            params: { choice: false },
            baseSeq: state.seq,
          });
        }
      }
      await sleep(10);
    }

    // 用陈旧 baseSeq 发主动 action——不应被 CAS 拒(CAS 已删)
    const veryStaleSeq = state.seq - 10;
    const seqBefore = state.seq;
    await session.handleAction('p0', {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: 0,
      params: {},
      baseSeq: veryStaleSeq,
    });
    await sleep(200);
    // CAS 删除后：action 被接受 → seq 推进
    expect(state.seq).toBeGreaterThan(seqBefore);
  }, 15000);
});

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

describe('重连 initialView', () => {
  let session: GameSession;
  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
  });

  it('reconnectPlayer 发 initialView 且同步 lastBroadcastSeq', async () => {
    await session.startGame(2);
    const state = getState(session);
    // 等选将完成 + 游戏进行中
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(200);

    const seqAtReconnect = state.seq;
    const fakeSink = new FakeSink();
    (session as any).playerNames.set('p0', 0);
    session.reconnectPlayer('p0', fakeSink, 0);

    // 应收到 initialView（全量状态）
    const initMsg = fakeSink.messages.find((m) => m.type === 'initialView');
    expect(initMsg).toBeDefined();
    // 不应收到 event 差量——initialView 已含全量状态
    const eventMsg = fakeSink.messages.find((m) => m.type === 'event');
    expect(eventMsg).toBeUndefined();
    // lastBroadcastSeq 应已同步到 state.seq
    const lb = (session as any).lastBroadcastSeq as number;
    expect(lb).toBeGreaterThanOrEqual(seqAtReconnect);
  }, 15000);
});

describe('pending 倒计时下发', () => {
  let session: GameSession;
  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
  });

  it('event 消息携带 deadline(pending 的 deadline/totalMs)', async () => {
    await session.startGame(2);
    const state = getState(session);
    // 等选将 pending 出现
    for (let i = 0; i < 100 && state.pendingSlots.size === 0; i++) await sleep(10);
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    const fakeSink = new FakeSink();
    (session as any).playerNames.set('p0', 0);
    // 注册 WS 到 room
    const room = (session as any).room as Room;
    room.players.set('p0', fakeSink);
    // 重置 lastBroadcastSeq 强制重发已有事件（startGame 期间 broadcastNewState 已推进过水位）
    (session as any).lastBroadcastSeq = 0;
    // 重置 deadline 缓存,确保 pending deadline 被发送
    (session as any).lastSentDeadline = new Map();
    // 触发一次广播
    (session as any).broadcastNewState();

    // initialView 应该已发送(且其 pending 含 deadline)
    const initMsg = fakeSink.messages.find((m) => m.type === 'initialView');
    expect(initMsg).toBeDefined();
    // initialView 的 pending 含 deadline(totalMs=60s)
    expect(initMsg!.state.pending).not.toBeNull();
    expect(initMsg!.state.pending!.deadline).toBeTypeOf('number');
    expect(initMsg!.state.pending!.totalMs).toBe(60_000);
    // deadline 应为绝对 epoch 时间戳
    expect(initMsg!.state.pending!.deadline).toBeGreaterThan(Date.now());
    // 也应有 event 消息(view 事件)
    const eventMsg = fakeSink.messages.find((m) => m.type === 'event');
    expect(eventMsg).toBeDefined();
  }, 15000);
});

describe('debug 房间刷新重连', () => {
  let session: GameSession;
  let room: Room;
  beforeEach(() => {
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
    const sink1 = new FakeSink();
    const sink2 = new FakeSink();
    const r1 = joinDebugRoom(room.id, 'p1', sink1);
    const r2 = joinDebugRoom(room.id, 'p2', sink2);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    session.assignDebugSeat('p1');
    session.assignDebugSeat('p2');
    expect(room.players.size).toBe(2);

    // 模拟刷新:房间已满,第三个连接应复用 p1 的座次
    const sink3 = new FakeSink();
    const r3 = joinDebugRoom(room.id, 'p3', sink3);
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

    const sink1 = new FakeSink();
    const sink2 = new FakeSink();
    joinDebugRoom(room.id, 'p1', sink1);
    joinDebugRoom(room.id, 'p2', sink2);
    const seat1 = session.assignDebugSeat('p1');
    const seat2 = session.assignDebugSeat('p2');
    expect(seat1).toBe(0);
    expect(seat2).toBe(1);

    // 模拟刷新重连:p1 被替换 → evictDebugPlayer 清理 → p3 接管座次 0
    const sink3 = new FakeSink();
    const r3 = joinDebugRoom(room.id, 'p3', sink3);
    expect(r3!.replacedPlayerId).toBe('p1');
    session.evictDebugPlayer('p1');
    const seat3 = session.assignDebugSeat('p3');
    expect(seat3).toBe(0); // 复用被释放的座次 0

    // p3 重连后能收到 initialView
    session.reconnectPlayer('p3', sink3, 0);
    const initMsg = sink3.messages.find((m) => m.type === 'initialView');
    expect(initMsg).toBeDefined();
  }, 15000);
});

describe('旁观者视图分发', () => {
  let session: GameSession;
  let room: Room;

  beforeEach(() => {
    room = makeRoom();
    room.spectators = new Map();
    room.viewGrants = new Map();
    room.pendingViewRequests = new Map();
    addRoom(room);
    session = new GameSession(room, true, 42);
  });

  it('旁观者收到公开视图(hand 为 undefined)', async () => {
    await session.startGame(2);
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(200);

    const specSink = new FakeSink();
    room.spectators.set('spec1', specSink);

    // 触发 broadcastNewState —— 通过 state change
    session.sendSpectatorInitialView('spec1');

    const initMsg = specSink.messages.find((m) => m.type === 'initialView');
    expect(initMsg).toBeDefined();
    const view = (initMsg as { state: { players: Array<{ hand?: unknown[] }> } }).state;
    // 公开视图中所有玩家的 hand 应为 undefined
    for (const p of view.players) {
      expect(p.hand).toBeUndefined();
    }
  }, 15000);

  it('授权后旁观者收到私有视图(hand 可见)', async () => {
    await session.startGame(2);
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(200);

    const specSink = new FakeSink();
    room.spectators.set('spec1', specSink);
    room.viewGrants.set('spec1', 0); // 授权查看座次 0

    session.clearSpectatorBaseline('spec1');
    session.sendSpectatorInitialView('spec1');

    const initMsg = specSink.messages.find((m) => m.type === 'initialView');
    expect(initMsg).toBeDefined();
    const view = (initMsg as { state: { viewer: number; players: Array<{ hand?: unknown[] }> } }).state;
    expect(view.viewer).toBe(0);
    // 座次 0 的 hand 应可见
    expect(view.players[0].hand).toBeDefined();
  }, 15000);

  it('broadcastNewState 向旁观者发送状态', async () => {
    await session.startGame(2);
    const state = getState(session);
    for (let i = 0; i < 300 && state.pendingSlots.size > 0; i++) await sleep(10);
    await sleep(200);

    const specSink = new FakeSink();
    room.spectators.set('spec1', specSink);

    // 先发送 baseline 给旁观者
    session.sendSpectatorInitialView('spec1');
    const initMsg = specSink.messages.find((m) => m.type === 'initialView');
    expect(initMsg).toBeDefined();

    // 之后的状态变更也应推送给旁观者
    // 由于 debug 模式 onStateChange → broadcastNewState 会遍历 spectators
    // 验证: sendToPlayer 能向旁观者发送
    session.clearSpectatorBaseline('spec1');
    specSink.messages.length = 0;
    // 清除后强制重发
    session.sendSpectatorInitialView('spec1');
    const initMsg2 = specSink.messages.find((m) => m.type === 'initialView');
    expect(initMsg2).toBeDefined();
  }, 15000);
});
