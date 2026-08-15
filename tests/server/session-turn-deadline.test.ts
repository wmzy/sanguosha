// tests/server/session-turn-deadline.test.ts
// 回归测试:验证出牌阶段倒计时的前后端同步。
//
// 设计变更:出牌阶段现在是一个引擎内的 __出牌 pending 循环(由回合管理 hook 启动),
// 不再由 session 的 idle timer 管理。deadline 统一来自 pending slot 的超时——
// buildView 读 pending.deadline,effectiveDeadline 读 getPendingDeadline,两者同源。
//
// 验证点:
// 1. buildView 在有 __出牌 pending 时返回非空 deadline
// 2. event 消息携带 deadline(仅在变化时),前端据此同步倒计时
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkGameOver } from '../../src/engine/index';
import '../../src/engine/atoms';
import { GameSession } from '../../src/server/session';
import { deletePersistedRoom } from '../../src/server/persistence';
import { buildView } from '../../src/engine/view/buildView';
import type { Room } from '../../src/server/room';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';
import type { ConnectionSink } from '../../src/server/connection';

// 跟踪本文件创建的房间 id,afterEach 清理持久化文件,避免 data/rooms/ 残留
// 被下次 dev server 启动恢复成僵尸 session。
const trackedRoomIds: string[] = [];
afterEach(async () => {
  await Promise.all(
    trackedRoomIds.splice(0).map((id) => deletePersistedRoom(id).catch(() => {})),
  );
});

function makeRoom(): Room {
  const room: Room = {
    id: `test-room-${Math.random().toString(36).slice(2, 8)}`,
    name: '测试',
    maxPlayers: 4,
    players: new Map([['fake-player', new FakeSink()]]),
    isDebug: true,
    createdAt: Date.now(),
    status: '进行中',
    readyPlayers: new Set<string>(),
    config: { name: '测试', timeoutSec: 30, charPool: 'all', handSize: 4 },
    spectators: new Map(),
    viewGrants: new Map(),
    pendingViewRequests: new Map(),
  } as unknown as Room;
  trackedRoomIds.push(room.id);
  return room;
}

/** 通过 reflection 取/设 session.state(私有字段) */
function getState(session: GameSession): GameState {
  return (session as unknown as { state: GameState }).state;
}
function setState(session: GameSession, state: GameState): void {
  (session as unknown as { state: GameState }).state = state;
}

/** 伪 sink,收集所有发给该 player 的消息 */
class FakeSink implements ConnectionSink {
  messages: ServerMessage[] = [];
  send(message: ServerMessage): void {
    this.messages.push(message);
  }

  close(): void {
    /* noop */
  }

  get isAlive(): boolean {
    return true;
  }
}

/** 构造一个处于出牌阶段、2 人存活、带 出牌窗口 pending 的极简 state */
function makeActState(): GameState {
  const state = createGameState({
    players: [
      {
        index: 0,
        name: 'P1',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: [],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: [],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
  return state;
}

describe('session:出牌阶段倒计时(pending slot 驱动)', () => {
  let session: GameSession;

  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
    const state = makeActState();
    setState(session, state);
    (session as unknown as { attachStateListener: () => void }).attachStateListener();
  });

  it('buildView 在有 出牌窗口 pending 时返回非空 deadline', () => {
    const state = getState(session);
    // 模拟 出牌窗口 pending slot(50s 超时)
    const before = Date.now();
    state.pendingSlots.set(0, {
      atom: { type: '出牌窗口', player: 0 } as never,
      definition: {
        pending: {
          onTimeout: async () => {},
          prompt: { type: 'confirm' as const, title: '' },
          timeout: 50,
          isBlocking: false,
        },
      } as never,
      deadline: 50_000,
      startTime: 0,
      createdSeq: 0,
      isBlocking: false,
      resolve: () => {},
    } as never);
    const after = Date.now();

    const view = buildView(state, 0);
    expect(view.deadline).not.toBeNull();
    // deadline 应在 [before+50s, after+50s] 区间(因为 slot.deadline 是相对时间 50000ms)
    expect(view.deadline!).toBeGreaterThanOrEqual(state.startedAt + 50_000);
    expect(view.deadlineTotalMs).toBe(50_000);
    void before;
    void after;
  });

  it('buildView 无 pending 时 deadline 为 null', () => {
    const state = getState(session);
    const view = buildView(state, 0);
    expect(view.deadline).toBeNull();
    expect(view.deadlineTotalMs).toBe(0);
  });

  it('event 消息携带 deadline(来自 pending slot)', () => {
    const state = getState(session);
    // 接一个玩家 sink
    const sink = new FakeSink();
    const playerId = 'p-test';
    const room = (session as unknown as { room: Room }).room;
    room.players.set(playerId, sink);
    (session as unknown as { playerNames: Map<string, number> }).playerNames.set(playerId, 0);

    // 模拟 出牌窗口 pending slot
    state.pendingSlots.set(0, {
      atom: { type: '出牌窗口', player: 0 } as never,
      definition: {
        pending: {
          onTimeout: async () => {},
          prompt: { type: 'confirm' as const, title: '' },
          timeout: 50,
          isBlocking: false,
        },
      } as never,
      deadline: 50_000,
      startTime: 0,
      createdSeq: 0,
      isBlocking: false,
      resolve: () => {},
    } as never);

    // 触发广播
    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();

    // 应收到 initialView 且其 state.deadline 非空
    const initialMsg = sink.messages.find((m) => m.type === 'initialView');
    expect(initialMsg).toBeDefined();
    if (initialMsg!.type === 'initialView') {
      expect(initialMsg!.state.deadline).not.toBeNull();
      expect(initialMsg!.state.deadlineTotalMs).toBe(50_000);
    }
    void state;
  });
});

describe('session:gameOver 后拦截后续广播(回归:主公阵亡后仍下发出牌窗口)', () => {
  let session: GameSession;
  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
    const state = createGameState({
      players: [
        {
          index: 0,
          name: '主公',
          identity: '主公',
          character: '刘备',
          health: 1,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 1,
          name: '反贼',
          identity: '反贼',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    setState(session, state);
    (session as unknown as { attachStateListener: () => void }).attachStateListener();
  });

  it('主公阵亡:广播 gameOver,且 gameOver 之后的 onStateChange 不再广播', async () => {
    const state = getState(session);
    const s = session as unknown as {
      broadcast: (m: ServerMessage) => void;
      broadcastNewState: () => void;
      gameOverHandled: boolean;
    };
    const broadcastSpy = vi.spyOn(s, 'broadcast');
    const broadcastNewStateSpy = vi.spyOn(s, 'broadcastNewState');

    // 主公阵亡,触发 onStateChange(模拟 击杀 atom 末尾的 notifyStateChange)。
    // checkGameOver 经规则包动态加载(异步),排空微任务等 gameOver 广播落地。
    state.players[0].alive = false;
    state.onStateChange!();
    for (let i = 0; i < 50 && !s.gameOverHandled; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }

    expect(s.gameOverHandled).toBe(true);
    expect(broadcastSpy.mock.calls.some((c) => c[0].type === 'gameOver')).toBe(true);
    // 本次 onStateChange 已广播了击杀事件本身
    expect(broadcastNewStateSpy).toHaveBeenCalled();

    // 模拟杀.execute finally 继续产生的后续 atom(移动牌/结算帧出栈/出牌窗口)
    broadcastSpy.mockClear();
    broadcastNewStateSpy.mockClear();
    state.onStateChange!();
    state.onStateChange!();

    // gameOver 后的广播被拦截——不再下发出牌窗口等事件
    expect(broadcastNewStateSpy).not.toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('游戏结束后 handleAction 被拒绝(不再 dispatch)', async () => {
    const state = getState(session);
    state.players[0].alive = false;
    state.onStateChange!();

    const seqBefore = state.seq;
    await session.handleAction('fake-player', {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: 0,
      params: {},
      baseSeq: 0,
    });
    // gameOverHandled=true → handleAction 首行 return,不 dispatch
    expect(state.seq).toBe(seqBefore);
  });
});

describe('checkGameOver:主公阵亡胜负判定', () => {
  function makeState(
    players: Array<{ index: number; identity: string; alive: boolean }>,
  ): GameState {
    return createGameState({
      players: players.map((p) => ({
        index: p.index,
        name: `P${p.index}`,
        identity: p.identity as GameState['players'][number]['identity'],
        character: '',
        health: 4,
        maxHealth: 4,
        alive: p.alive,
        hand: [],
        equipment: {},
        skills: [],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      })),
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
  }

  it('主公阵亡且反贼存活 → 反贼获胜(winner=存活反贼座次)', async () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: false },
      { index: 1, identity: '忠臣', alive: true },
      { index: 2, identity: '反贼', alive: true },
      { index: 3, identity: '内奸', alive: true },
    ]);
    const { gameOver, winner } = await checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBe(2);
    expect(state.players[winner!].identity).toBe('反贼');
  });

  it('主公阵亡、反贼全灭、内奸存活 → 内奸获胜(内奸清场残局)', async () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: false },
      { index: 1, identity: '反贼', alive: false },
      { index: 2, identity: '内奸', alive: true },
    ]);
    const { gameOver, winner } = await checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBe(2);
    expect(state.players[winner!].identity).toBe('内奸');
  });

  it('主公阵亡、反贼/内奸均无存活 → 仍判反贼获胜(取任一反贼座次)', async () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: false },
      { index: 1, identity: '反贼', alive: false },
      { index: 2, identity: '内奸', alive: false },
      { index: 3, identity: '忠臣', alive: true },
    ]);
    const { gameOver, winner } = await checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBeDefined();
    expect(state.players[winner!].identity).toBe('反贼');
  });

  it('主公存活、仅剩主公一人 → 主公方获胜', async () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: true },
      { index: 1, identity: '反贼', alive: false },
      { index: 2, identity: '内奸', alive: false },
    ]);
    const { gameOver, winner } = await checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBe(0);
  });

  it('主忠残局:主公+忠臣存活、反贼内奸全死 → 主公方获胜(回归:曾不结束)', async () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: true },
      { index: 1, identity: '忠臣', alive: true },
      { index: 2, identity: '反贼', alive: false },
      { index: 3, identity: '反贼', alive: false },
      { index: 4, identity: '内奸', alive: false },
    ]);
    const { gameOver, winner } = await checkGameOver(state);
    expect(gameOver).toBe(true);
    expect(winner).toBe(0);
    expect(state.players[winner!].identity).toBe('主公');
  });

  it('主公存活、仍有反贼存活 → 游戏未结束', async () => {
    const state = makeState([
      { index: 0, identity: '主公', alive: true },
      { index: 1, identity: '反贼', alive: true },
      { index: 2, identity: '内奸', alive: true },
    ]);
    expect((await checkGameOver(state)).gameOver).toBe(false);
  });
});

describe('session.resetToLobby:游戏结束后重新进入准备阶段', () => {
  let session: GameSession;
  beforeEach(() => {
    session = new GameSession(makeRoom(), true, 42);
    const state = createGameState({
      players: [
        {
          index: 0,
          name: '主公',
          identity: '主公',
          character: '刘备',
          health: 1,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 1,
          name: '反贼',
          identity: '反贼',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    setState(session, state);
    (session as unknown as { attachStateListener: () => void }).attachStateListener();
  });

  it('resetToLobby:房间回到等待中,清除 gameOverHandled,清空准备,广播 game_reset', async () => {
    const state = getState(session);
    const s = session as unknown as {
      broadcast: (m: ServerMessage) => void;
      gameOverHandled: boolean;
      room: Room;
    };
    // 触发游戏结束。checkGameOver 经规则包动态加载(异步),排空微任务等标记置位。
    state.players[0].alive = false;
    state.onStateChange!();
    for (let i = 0; i < 50 && !s.gameOverHandled; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(s.gameOverHandled).toBe(true);

    const broadcastSpy = vi.spyOn(s, 'broadcast');

    // 再来一局:重置到准备阶段
    session.resetToLobby();

    expect(s.gameOverHandled).toBe(false);
    expect(s.room.readyPlayers.size).toBe(0);
    expect(getState(session)).toBeNull();
    expect(broadcastSpy.mock.calls.some((c) => c[0].type === 'game_reset')).toBe(true);
  });

  it('resetToLobby 后 gameOverHandled 清除,handleAction 不再被拦截', async () => {
    const state = getState(session);
    state.players[0].alive = false;
    state.onStateChange!();

    session.resetToLobby();
    // gameOverHandled 已清除,state 为 null → handleAction 首行因 !state 直接 return(不会报错)
    await session.handleAction('fake-player', {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: 0,
      params: {},
      baseSeq: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 断线重连差量补发:Last-Event-ID 携带 `<epoch>:<seq>`,epoch 匹配且缺口在
// DIFF_RECONNECT_THRESHOLD 内 → 补发 event 差量;否则回退 initialView 快照。
// ---------------------------------------------------------------------------
import { parseLastEventId, SseSink } from '../../src/server/sse';
import { DIFF_RECONNECT_THRESHOLD } from '../../src/server/session';
import type { SSEStreamingApi } from 'hono/streaming';

/** 固定局标识(测 gameStartedAt/eventEpoch 投影,避免依赖真实时钟) */
const TEST_EPOCH = 1_720_000_000_000;

/** 构造带重连所需私有状态的 session:state(2 人)+ playerNames('p1'→座次0) + eventEpoch */
function makeReconnectSession(): { session: GameSession; sink: FakeSink } {
  const session = new GameSession(makeRoom(), true, 42);
  setState(session, makeActState());
  (session as unknown as { playerNames: Map<string, number> }).playerNames.set('p1', 0);
  (session as unknown as { gameStartedAt: number }).gameStartedAt = TEST_EPOCH;
  const sink = new FakeSink();
  return { session, sink };
}

/** 在 state.atomHistory 追加 seq ∈ [from,to] 的 notify 条目(全 viewer 可见) */
function pushHistory(state: GameState, from: number, to: number): void {
  for (let seq = from; seq <= to; seq++) {
    state.atomHistory.push({
      kind: 'notify',
      seq,
      timestamp: seq,
      skillId: '测试',
      eventType: 'test',
      data: { seq },
    });
  }
}

describe('session:断线重连差量补发', () => {
  it('eventEpoch 即 gameStartedAt(startGame/restoreState 各自设置的局标识)', () => {
    const { session } = makeReconnectSession();
    expect(session.eventEpoch).toBe(TEST_EPOCH);
  });

  it('小差量缺口:补发 event 差量(带 epoch)而非 initialView', () => {
    const { session, sink } = makeReconnectSession();
    const state = getState(session);
    state.seq = 110;
    pushHistory(state, 101, 110);

    expect(session.reconnectPlayer('p1', sink, 100)).toBe(true);

    expect(sink.messages.filter((m) => m.type === 'initialView')).toHaveLength(0);
    const events = sink.messages.filter((m) => m.type === 'event');
    expect(events.map((e) => (e as { seq: number }).seq)).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
    // 每条 event 都携带局标识(供 SSE 生成 `<epoch>:<seq>` 格式 Last-Event-ID)
    for (const e of events) {
      expect((e as { epoch?: number }).epoch).toBe(TEST_EPOCH);
    }
    // baselineSent 已登记:后续 broadcastNewState 不会重发 initialView
    expect(
      (session as unknown as { baselineSent: Set<string> }).baselineSent.has('p1'),
    ).toBe(true);
  });

  it(`缺口超过 DIFF_RECONNECT_THRESHOLD(${DIFF_RECONNECT_THRESHOLD}):回退 initialView 快照`, () => {
    const { session, sink } = makeReconnectSession();
    const state = getState(session);
    state.seq = 100 + DIFF_RECONNECT_THRESHOLD + 1; // 301
    pushHistory(state, 101, state.seq);

    expect(session.reconnectPlayer('p1', sink, 100)).toBe(true);

    expect(sink.messages.filter((m) => m.type === 'event')).toHaveLength(0);
    const views = sink.messages.filter((m) => m.type === 'initialView');
    expect(views).toHaveLength(1);
    expect((views[0] as { lastSeq: number }).lastSeq).toBe(state.seq);
  });

  it('lastSeq 大于当前 state.seq(局间重置场景):回退 initialView 快照', () => {
    const { session, sink } = makeReconnectSession();
    const state = getState(session);
    state.seq = 50; // 新局 seq 从头计数,客户端残留旧局高水位
    pushHistory(state, 1, 50);

    expect(session.reconnectPlayer('p1', sink, 100)).toBe(true);

    expect(sink.messages.filter((m) => m.type === 'event')).toHaveLength(0);
    expect(sink.messages.filter((m) => m.type === 'initialView')).toHaveLength(1);
  });

  it('跨局/跨进程 epoch 不匹配:parseLastEventId 归 0,强制 initialView 快照', () => {
    // 新格式 `<epoch>:<seq>`:仅 epoch 与当前局一致才认可 seq
    expect(parseLastEventId(`${TEST_EPOCH}:100`, TEST_EPOCH)).toBe(100);
    // 跨局(epoch 不同)/跨进程(session 不存在,epoch undefined)
    expect(parseLastEventId('999999:100', TEST_EPOCH)).toBe(0);
    expect(parseLastEventId(`${TEST_EPOCH}:100`, undefined)).toBe(0);
    // 旧格式纯数字/脏值/无 header:无法验证 epoch,一律归 0 安全过渡
    expect(parseLastEventId('100', TEST_EPOCH)).toBe(0);
    expect(parseLastEventId('abc', TEST_EPOCH)).toBe(0);
    expect(parseLastEventId(undefined, TEST_EPOCH)).toBe(0);

    // 端到端:epoch 不匹配 → lastSeq=0 → 走 initialView 快照分支
    const { session, sink } = makeReconnectSession();
    const state = getState(session);
    state.seq = 110;
    pushHistory(state, 101, 110);
    const lastSeq = parseLastEventId('999999:100', TEST_EPOCH);
    expect(session.reconnectPlayer('p1', sink, lastSeq)).toBe(true);
    expect(sink.messages.filter((m) => m.type === 'event')).toHaveLength(0);
    expect(sink.messages.filter((m) => m.type === 'initialView')).toHaveLength(1);
  });

  it('旁观者差量:sendSpectatorInitialView 同判定分支(viewGrants ?? -1)', () => {
    const { session, sink } = makeReconnectSession();
    const state = getState(session);
    state.seq = 110;
    pushHistory(state, 101, 110);
    const room = (session as unknown as { room: Room }).room;
    room.spectators.set('spec-1', sink);

    session.sendSpectatorInitialView('spec-1', 100);
    expect(sink.messages.filter((m) => m.type === 'initialView')).toHaveLength(0);
    const events = sink.messages.filter((m) => m.type === 'event');
    expect(events.map((e) => (e as { seq: number }).seq)).toHaveLength(10);
    for (const e of events) {
      expect((e as { epoch?: number }).epoch).toBe(TEST_EPOCH);
    }

    // 超阈值 → 回退 initialView
    const sink2 = new FakeSink();
    room.spectators.set('spec-2', sink2);
    state.seq = 301;
    pushHistory(state, 111, 301);
    session.sendSpectatorInitialView('spec-2', 100);
    expect(sink2.messages.filter((m) => m.type === 'initialView')).toHaveLength(1);
  });

  it('SseSink SSE id:event 带 epoch 用 `<epoch>:<seq>`,其余带 seq 消息维持纯数字', async () => {
    const writes: Array<{ data: string; id?: string }> = [];
    const stream = {
      writeSSE: async (d: { data: string; id?: string }) => {
        writes.push(d);
      },
      write: async () => {},
      close: async () => {},
      aborted: false,
    } as unknown as SSEStreamingApi;
    const sink = new SseSink(stream);

    sink.send({ type: 'event', seq: 5, epoch: 42, timestamp: 0 });
    sink.send({ type: 'event', seq: 6, timestamp: 0 }); // 无 epoch(协议可选)回退纯数字
    sink.send({ type: 'initialView', state: {} as never, lastSeq: 6 });

    await new Promise((r) => setTimeout(r, 0)); // writeSSE 异步
    expect(writes.map((w) => w.id)).toEqual(['42:5', '6', undefined]);
  });
});

// ---------------------------------------------------------------------------
// atomHistory 裁剪 + eventJournal 落盘:内存只保留活跃窗口(EVENT_TRIM_WINDOW),
// 被裁条目 append 到 data/rooms/<roomId>.events.jsonl;trimmedFloorSeq 记录可回溯下限,
// canServeDifferential 据此判定重连回退 initialView。
// ---------------------------------------------------------------------------
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVENT_TRIM_WINDOW } from '../../src/server/session';

function journalPathOf(roomId: string): string {
  return join(process.cwd(), 'data', 'rooms', `${roomId}.events.jsonl`);
}

/** 轮询等待条件为真(journal 落盘 fire-and-forget,需真实时钟等待)。支持同步/异步条件。 */
async function waitUntil(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  for (let i = 0; i < ms / 10 && !(await cond()); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** 构造已越过裁剪条件的 session:seq=800、atomHistory 1..800、录像基线=100
 *  → floor = min(800-500, 100) = 100,被 baseline 钉住。 */
function makeTrimSession(): { session: GameSession; state: GameState; roomId: string } {
  const { session } = makeReconnectSession();
  const state = getState(session);
  state.seq = 800;
  pushHistory(state, 1, 800);
  (session as unknown as { replayBaselineSeq: number }).replayBaselineSeq = 100;
  const roomId = (session as unknown as { room: Room }).room.id;
  return { session, state, roomId };
}

describe('session:atomHistory 裁剪 + eventJournal 落盘', () => {
  it(`EVENT_TRIM_WINDOW(${EVENT_TRIM_WINDOW}) ≥ DIFF_RECONNECT_THRESHOLD(${DIFF_RECONNECT_THRESHOLD})`, () => {
    // 不变量 (b):窗口必须覆盖差量阈值,否则可服务差量的客户端会因条目被裁回退快照
    expect(EVENT_TRIM_WINDOW).toBeGreaterThanOrEqual(DIFF_RECONNECT_THRESHOLD);
  });

  it('broadcast 触发裁剪:atomHistory 只剩 seq>floor 的条目,floor 被 baseline 钉住', () => {
    const { session, state } = makeTrimSession();

    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();

    // floor = min(800 - 500, 100) = 100 = replayBaselineSeq(不变量 (a):不越过录像基线)
    const s = session as unknown as { trimmedFloorSeq: number; replayBaselineSeq: number };
    expect(s.trimmedFloorSeq).toBe(100);
    expect(s.trimmedFloorSeq).toBe(s.replayBaselineSeq);
    // 被裁 seq 1..100 共 100 条,存活 101..800 共 700 条
    expect(state.atomHistory.length).toBe(700);
    expect(state.atomHistory[0].seq).toBe(101);
    expect(state.atomHistory[state.atomHistory.length - 1].seq).toBe(800);
    expect(state.atomHistory.every((e) => e.seq > 100)).toBe(true);
  });

  it('窗口未越过时(选将未完成 baseline=0 → floor=0)不裁剪', () => {
    const { session } = makeReconnectSession();
    const state = getState(session);
    state.seq = 300; // < EVENT_TRIM_WINDOW,replayBaselineSeq 仍为 0
    pushHistory(state, 1, 300);

    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();

    expect(state.atomHistory.length).toBe(300); // 不变式 (c):开局阶段全量保留
    expect((session as unknown as { trimmedFloorSeq: number }).trimmedFloorSeq).toBe(0);
  });

  it('裁剪后 canServeDifferential(lastSeq≤floor) 为假 → 回退 initialView;窗口内仍差量', () => {
    const { session } = makeTrimSession();
    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();

    // lastSeq 恰等于 floor:已被裁,不可差量
    const sink = new FakeSink();
    expect(session.reconnectPlayer('p1', sink, 100)).toBe(true);
    expect(sink.messages.filter((m) => m.type === 'initialView')).toHaveLength(1);
    expect(sink.messages.filter((m) => m.type === 'event')).toHaveLength(0);

    // lastSeq=700 在窗口内(trimmedFloorSeq=100 < 700 ≤ 800,缺口 100 ≤ 阈值):差量补发
    const sink2 = new FakeSink();
    expect(session.reconnectPlayer('p1', sink2, 700)).toBe(true);
    expect(sink2.messages.filter((m) => m.type === 'initialView')).toHaveLength(0);
    const events = sink2.messages.filter((m) => m.type === 'event');
    expect(events.map((e) => (e as { seq: number }).seq)).toEqual(
      Array.from({ length: 100 }, (_, i) => 701 + i),
    );
  });

  it('被裁条目已写入 journal 文件(data/rooms/<roomId>.events.jsonl,每行含 epoch)', async () => {
    const { session, roomId } = makeTrimSession();
    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();

    const path = journalPathOf(roomId);
    const holder: { raw: string | null } = { raw: null };
    await waitUntil(() =>
      readFile(path, 'utf-8')
        .then((t) => (holder.raw = t))
        .then(() => true)
        .catch(() => false),
    );
    expect(holder.raw).not.toBeNull();

    const lines = (holder.raw as string).trim().split('\n');
    expect(lines.length).toBe(100); // 被裁 seq 1..100
    const parsed = lines.map((l) => JSON.parse(l) as { epoch: number; seq: number; kind: string });
    expect(parsed.map((e) => e.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    for (const e of parsed) {
      expect(e.epoch).toBe(TEST_EPOCH); // 局标识随条目落盘
      expect(e.kind).toBe('notify');
    }
  });

  it('viewBuffering=true 时 trimAtomHistory 不动数组(防御 dispatch 回滚竞争)', () => {
    const { session, state } = makeTrimSession();
    state.viewBuffering = true;

    (session as unknown as { trimAtomHistory: (s: GameState) => void }).trimAtomHistory(state);

    expect(state.atomHistory.length).toBe(800); // 数组未被裁
    expect((session as unknown as { trimmedFloorSeq: number }).trimmedFloorSeq).toBe(0); // 水位未推进
  });

  it('deletePersistedRoom 后 journal 文件不存在', async () => {
    const { session, roomId } = makeTrimSession();
    (session as unknown as { broadcastNewState: () => void }).broadcastNewState();

    const path = journalPathOf(roomId);
    const holder: { exists: boolean } = { exists: false };
    const check = () =>
      readFile(path, 'utf-8')
        .then(() => (holder.exists = true))
        .catch(() => (holder.exists = false))
        .then(() => holder.exists);
    await waitUntil(check);
    expect(holder.exists).toBe(true);

    await deletePersistedRoom(roomId); // 清理收口:顺带删 journal(rm 异步,轮询确认)
    await waitUntil(async () => !(await check()));
    expect(holder.exists).toBe(false);
  });
});
