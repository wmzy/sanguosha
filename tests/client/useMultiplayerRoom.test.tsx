// @vitest-environment jsdom
// tests/client/useMultiplayerRoom.test.tsx
// useMultiplayerRoom hook 单元测试:验证多人模式连接生命周期与「再来一局」状态流转。
//
// 传输层:HeadlessGameClient 使用 REST(fetch POST C→S 命令)+ SSE(EventSource S→C 事件流)。
// 本文件用 MockEventSource + MockFetch 替代真实传输,测试驱动连接生命周期与状态流转。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiplayerRoom } from '../../src/client/hooks/useMultiplayerRoom';
import type { GameView } from '../../src/engine/types';
import { DEFAULT_ROOM_CONFIG, type ServerMessage } from '../../src/server/protocol';

/** 可控的 EventSource mock:测试驱动 onopen/onmessage,捕获实例。 */
class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static last: MockEventSource | null = null;
  static instances: MockEventSource[] = [];
  readyState = MockEventSource.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.last = this;
    MockEventSource.instances.push(this);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  /** 测试驱动:模拟 SSE 连接建立 */
  fireOpen() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  /** 测试驱动:模拟服务端推送 ServerMessage */
  emit(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  static reset() {
    MockEventSource.last = null;
    MockEventSource.instances = [];
  }
}

/** 捕获 fetch 调用(REST C→S 命令:create/join/ready/start/restart/action/reorder)。 */
const fetchCalls: Array<{ url: string; method: string; body: any }> = [];

function makeBaseline(viewer: number): GameView {
  return {
    viewer,
    currentPlayerIndex: viewer,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: viewer,
        name: 'P0',
        character: '主公',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 4,
        hand: [],
        marks: [],
      },
    ],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

describe('useMultiplayerRoom', () => {
  beforeEach(() => {
    MockEventSource.reset();
    fetchCalls.length = 0;
    localStorage.clear();
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      const body = opts?.body ? JSON.parse(opts.body as string) : {};
      fetchCalls.push({ url, method: opts?.method ?? 'GET', body });
      // join 响应:POST /api/rooms/:id/join
      if (url.includes('/api/rooms/') && url.includes('/join')) {
        return new Response(JSON.stringify({ roomId: 'ROOM1', playerId: 'pid-0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // createRoom 响应:POST /api/rooms
      if (url.includes('/api/rooms') && opts?.method === 'POST') {
        return new Response(JSON.stringify({ roomId: 'ROOM1', playerId: 'pid-0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // ready/start/restart/action/reorder/config — 简单 OK
      return new Response('{}', { status: 200 });
    }));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 刷新 createRoom/joinRoom 的 async fetch+openStream 链,确保 EventSource 已创建。 */
  async function flushConnect() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  /** 推送 SSE 消息并推进轮询定时器(同步 hgc.roomId/playerId 到 React state)。 */
  function emitAndSync(es: MockEventSource, msg: ServerMessage) {
    act(() => es.emit(msg));
    act(() => {
      vi.advanceTimersByTime(250);
    });
  }

  /** 创建房间并完成 SSE 连接握手,返回 EventSource 实例。 */
  async function openRoom(name = '测试房', max = 2) {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom(name, max));
    await flushConnect();
    const es = MockEventSource.last!;
    act(() => es.fireOpen());
    return { result, es };
  }

  it('createRoom 后收到 room_joined 进入 waiting 阶段', async () => {
    const { result } = await openRoom();
    const es = MockEventSource.last!;
    emitAndSync(es, { type: 'room_joined', roomId: 'ROOM1', playerId: 'pid-0', seatIndex: 0 });

    expect(result.current.stage).toBe('waiting');
    expect(result.current.roomId).toBe('ROOM1');
    expect(result.current.playerId).toBe('pid-0');
  });

  it('再来一局:sendRestart 发送 restart_game 消息', async () => {
    const { result } = await openRoom();

    act(() => result.current.sendRestart());

    expect(fetchCalls.some((c) => c.url.includes('/restart'))).toBe(true);
  });

  it('game_reset 后从 ended 回到 waiting,清除 gameOver/view,ready 复位', async () => {
    const { result, es } = await openRoom();
    // 进入房间
    emitAndSync(es, { type: 'room_joined', roomId: 'ROOM1', playerId: 'pid-0', seatIndex: 0 });
    // 开局进入对局
    act(() => es.emit({ type: 'game_started' }));
    act(() => es.emit({ type: 'initialView', state: makeBaseline(0), lastSeq: 3 }));
    expect(result.current.stage).toBe('playing');
    // 游戏结束
    act(() => es.emit({ type: 'gameOver', winner: '主公阵营' }));
    expect(result.current.stage).toBe('ended');
    expect(result.current.gameOver).toEqual({ winner: '主公阵营' });

    // 再来一局:服务端 resetToLobby 后广播 game_reset
    act(() => es.emit({ type: 'game_reset' }));

    expect(result.current.stage).toBe('waiting');
    expect(result.current.gameOver).toBeNull();
    expect(result.current.view).toBeNull();
    expect(result.current.ready).toBe(false);
  });

  it('game_reset 后保留 roomId/playerId(未退出房间)', async () => {
    const { result, es } = await openRoom();
    emitAndSync(es, { type: 'room_joined', roomId: 'ROOM1', playerId: 'pid-0', seatIndex: 0 });
    act(() => es.emit({ type: 'game_started' }));
    act(() => es.emit({ type: 'initialView', state: makeBaseline(0), lastSeq: 1 }));
    act(() => es.emit({ type: 'gameOver', winner: '主公阵营' }));

    act(() => es.emit({ type: 'game_reset' }));

    // 回到准备阶段但仍在同一房间
    expect(result.current.roomId).toBe('ROOM1');
    expect(result.current.playerId).toBe('pid-0');
  });

  // ─── 连接命令与入座路径 ───

  it('joinRoom 显式加入房间后 open 发送 join_room', async () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.joinRoom('ROOM-JOIN'));
    await flushConnect();
    const es = MockEventSource.last!;
    act(() => es.fireOpen());
    expect(fetchCalls.some((c) => c.url.includes('/join') && c.url.includes('ROOM-JOIN'))).toBe(
      true,
    );
  });

  it('initialRoomId 提供时自动 join(分享链接直达)', async () => {
    renderHook(() => useMultiplayerRoom('ROOM-DEEPLINK'));
    await flushConnect();
    expect(
      fetchCalls.some((c) => c.url.includes('/join') && c.url.includes('ROOM-DEEPLINK')),
    ).toBe(true);
  });

  it('createRoom 空名时生成默认房间名', async () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('', 2));
    await flushConnect();
    // createRoom 的 POST /api/rooms body 含 name 字段
    const create = fetchCalls.find((c) => c.body && typeof c.body.name === 'string');
    expect(create).toBeTruthy();
    // 默认名形如 "房间XXXX"
    expect(create!.body.name).toMatch(/^房间[A-Z0-9]+$/);
  });

  it('createRoom 携带 config 时透传到 create_room 消息', async () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('房', 2, { ...DEFAULT_ROOM_CONFIG, timeoutScale: 2 }));
    await flushConnect();
    const create = fetchCalls.find((c) => c.body && typeof c.body.name === 'string')!;
    expect(create.body.config?.timeoutScale).toBe(2);
  });

  it('createRoom 把本地身份 playerId 透传到请求体', async () => {
    localStorage.setItem('sgs:playerId', '赵子龙');
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('房', 2));
    await flushConnect();
    const create = fetchCalls.find((c) => c.body && typeof c.body.name === 'string')!;
    expect(create.body.playerId).toBe('赵子龙');
  });

  it('joinRoom 把本地身份 playerId 透传到请求体', async () => {
    localStorage.setItem('sgs:playerId', '孔明');
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.joinRoom('ROOM-X'));
    await flushConnect();
    const join = fetchCalls.find((c) => c.url.includes('/join') && c.url.includes('ROOM-X'))!;
    expect(join.body.playerId).toBe('孔明');
  });

  it('无本地身份时 createRoom 不传 playerId(服务端自动生成)', async () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('房', 2));
    await flushConnect();
    const create = fetchCalls.find((c) => c.body && typeof c.body.name === 'string')!;
    expect(create.body.playerId).toBeUndefined();
  });

  // ─── 房间状态与准备/开局 ───

  it('room_state 同步后 isHost 在房主本人座次为 true', async () => {
    const { result, es } = await openRoom();
    emitAndSync(es, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    emitAndSync(es, {
      type: 'room_state',
      readyPlayers: [],
      playerIds: ['pid-0'],
      hostId: 'pid-0',
      maxPlayers: 2,
      config: DEFAULT_ROOM_CONFIG,
      spectatorIds: [],
      viewGrants: {},
      pendingViewRequests: {},
    });
    expect(result.current.isHost).toBe(true);
    expect(result.current.roomState?.hostId).toBe('pid-0');
  });

  it('toggleReady 发送 ready，ready 状态跟随 room_state', async () => {
    const { result, es } = await openRoom();
    emitAndSync(es, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    act(() => result.current.toggleReady());
    expect(fetchCalls.some((c) => c.url.includes('/ready'))).toBe(true);

    // ready 从服务端 room_state 派生，初始为 false
    expect(result.current.ready).toBe(false);

    // 服务端广播 room_state 更新 readyPlayers 后 ready 变 true
    emitAndSync(es, {
      type: 'room_state',
      readyPlayers: ['pid-0'],
      playerIds: ['pid-0'],
      hostId: 'pid-0',
      maxPlayers: 2,
      config: DEFAULT_ROOM_CONFIG,
      spectatorIds: [],
      viewGrants: {},
      pendingViewRequests: {},
    });
    expect(result.current.ready).toBe(true);

    // 再次 toggleReady 应发送 cancel-ready
    act(() => result.current.toggleReady());
    expect(fetchCalls.some((c) => c.url.includes('/cancel-ready'))).toBe(true);
  });

  it('startGame 发送 start_game', async () => {
    const { result, es } = await openRoom();
    emitAndSync(es, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    act(() => result.current.startGame());
    expect(fetchCalls.some((c) => c.url.includes('/start'))).toBe(true);
  });

  // ─── 错误处理 ───

  it('收到 error 消息后 setError,3 秒后自动清除', async () => {
    const { result, es } = await openRoom();
    emitAndSync(es, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    act(() => es.emit({ type: 'error', message: '房间已满' }));
    expect(result.current.error).toBe('房间已满');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.error).toBeNull();
  });

  it('gameOver 消息设置 gameOver.winner', async () => {
    const { result, es } = await openRoom();
    emitAndSync(es, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    act(() => es.emit({ type: 'gameOver', winner: '反贼阵营' }));
    expect(result.current.gameOver).toEqual({ winner: '反贼阵营' });
    expect(result.current.stage).toBe('ended');
  });

  // ─── 离开与无连接守卫 ───

  it('leaveRoom 回到 lobby,清空全部房间状态,并断开连接', async () => {
    const { result, es } = await openRoom();
    emitAndSync(es, { type: 'room_joined', roomId: 'ROOM1', playerId: 'pid-0', seatIndex: 0 });
    expect(result.current.stage).toBe('waiting');

    act(() => result.current.leaveRoom());

    expect(result.current.stage).toBe('lobby');
    expect(result.current.roomId).toBeNull();
    expect(result.current.playerId).toBeNull();
    expect(result.current.roomState).toBeNull();
    expect(result.current.view).toBeNull();
    expect(result.current.ready).toBe(false);
    // 原连接被断开(EventSource.close)
    expect(es.readyState).toBe(MockEventSource.CLOSED);
  });

  it('leaveRoom 后(无连接)toggleReady/startGame/sendAction/reorderHand 均为 no-op', async () => {
    const { result, es } = await openRoom();
    emitAndSync(es, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    const callsBefore = fetchCalls.length;

    act(() => result.current.leaveRoom());

    expect(() => {
      act(() => result.current.toggleReady());
      act(() => result.current.startGame());
      act(() => result.current.sendRestart());
      act(() =>
        result.current.sendAction({ skillId: '杀', actionType: 'use', ownerId: 0, params: {} }),
      );
      act(() => result.current.reorderHand(['a', 'b']));
    }).not.toThrow();
    // 断开后无新 fetch 发出
    expect(fetchCalls.length).toBe(callsBefore);
  });

  // ─── 房间不存在的 404 处理 ───

  it('autoJoin 房间不存在(404)时设置 notFound', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));
    const { result } = renderHook(() => useMultiplayerRoom('GHOST-ROOM'));
    await flushConnect();
    expect(result.current.notFound).toBe(true);
    // autoJoin 404 不设 error（由 404 页面接管 UI）
    expect(result.current.error).toBeNull();
  });

  it('手动 joinRoom 房间不存在(404)时回到 lobby 并设置 error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.joinRoom('GHOST-ROOM'));
    await flushConnect();
    expect(result.current.notFound).toBe(false);
    expect(result.current.stage).toBe('lobby');
    expect(result.current.error).toBe('房间不存在');
  });
});
