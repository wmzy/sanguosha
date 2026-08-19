// @vitest-environment jsdom
// tests/client/useMultiplayerRoom.test.tsx
// useMultiplayerRoom hook 单元测试:验证多人模式连接生命周期与「再来一局」状态流转。
//
// 传输层:HeadlessGameClient 使用 REST(fetch POST C→S 命令)+ SSE(EventSource S→C 事件流)。
// 本文件用 MockEventSource + MockFetch 替代真实传输,测试驱动连接生命周期与状态流转。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiplayerRoom } from '../../src/client/hooks/useMultiplayerRoom';
import { downloadLatestReplay } from '../../src/client/hooks/useRoomHistory';
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
      // 登录态探测:playerId 现从会话用户派生(游客模式已移除)
      if (url.includes('/api/auth/me')) {
        return new Response(
          JSON.stringify({ user: { id: 'pid-0', username: 'test', displayName: '测试用户', avatarUrl: null, provider: 'local', hasPassword: true, githubLinked: false }, githubEnabled: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
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

  /** 推送 SSE 消息(roomId/playerId/isSpectator 由 HGC onIdentityChange 回调同步到 React state)。 */
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
    act(() => result.current.createRoom('房', 2, { ...DEFAULT_ROOM_CONFIG, timeoutSec: 2 }));
    await flushConnect();
    const create = fetchCalls.find((c) => c.body && typeof c.body.name === 'string')!;
    expect(create.body.config?.timeoutSec).toBe(2);
  });

  it('createRoom 不透传 playerId(身份由服务端会话决定)', async () => {
    // 游客模式移除:playerId = 会话 userId,请求体不再携带本地身份
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('房', 2));
    await flushConnect();
    const create = fetchCalls.find((c) => c.body && typeof c.body.name === 'string')!;
    expect(create.body.playerId).toBeUndefined();
  });

  it('joinRoom 不透传 playerId(身份由服务端会话决定)', async () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.joinRoom('ROOM-X'));
    await flushConnect();
    const join = fetchCalls.find((c) => c.url.includes('/join') && c.url.includes('ROOM-X'))!;
    expect(join.body.playerId ?? join.body).toBeDefined();
    expect(join.body.playerId).toBeUndefined();
  });

  it('createRoom 请求发出(未登录时也发起,门禁在路由层)', async () => {
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
      seats: ['pid-0', null],
      pendingSeatSwaps: {},
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
      seats: ['pid-0', null],
      pendingSeatSwaps: {},
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
    // playerId 从登录态派生,离开房间不清(用户仍登录)
    expect(result.current.playerId).toBe('pid-0');
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

  it('joinAsSpectator 后 roomId 同步到 React state(用于 URL 同步)', async () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.joinAsSpectator('ROOM1'));
    await flushConnect();
    const es = MockEventSource.last!;
    act(() => es.fireOpen());
    // 推进轮询定时器,触发 roomId 同步(spectating 阶段也必须运行同步)
    act(() => vi.advanceTimersByTime(250));

    expect(result.current.stage).toBe('spectating');
    expect(result.current.roomId).toBe('ROOM1');
    expect(result.current.isSpectator).toBe(true);
  });

  it('autoJoin 玩家加入失败(游戏已开始)时自动降级为旁观者(修复刷新死循环)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetchCalls.push({ url, method: 'POST', body: {} });
        // /join(不含 -spectator)→ 400 游戏已开始
        if (url.includes('/join') && !url.includes('-spectator')) {
          return new Response(JSON.stringify({ error: '游戏已开始' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // /join-spectator → 200 成功
        return new Response(JSON.stringify({ roomId: 'ROOM1', playerId: 'pid-0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const { result } = renderHook(() => useMultiplayerRoom('ROOM1'));
    // 第一次 flush:autoJoin joinRoom → 400 → catch → setCommand(spectate)
    await flushConnect();
    // 第二次 flush:spectate joinAsSpectator → 200 → openStream → EventSource
    await flushConnect();
    const es = MockEventSource.last!;
    act(() => es.fireOpen());
    act(() => vi.advanceTimersByTime(250));

    // 降级成功:进入旁观阶段
    expect(result.current.stage).toBe('spectating');
    expect(result.current.isSpectator).toBe(true);
    expect(result.current.notFound).toBe(false);
    // 验证降级路径:先尝试 /join,失败后自动 /join-spectator
    expect(fetchCalls.some((c) => c.url.includes('/join') && !c.url.includes('-spectator'))).toBe(true);
    expect(fetchCalls.some((c) => c.url.includes('/join-spectator'))).toBe(true);
  });

  it('autoJoin 房间已满时也自动降级为旁观者', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/join') && !url.includes('-spectator')) {
          return new Response(JSON.stringify({ error: '房间已满' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ roomId: 'ROOM1', playerId: 'pid-0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const { result } = renderHook(() => useMultiplayerRoom('ROOM1'));
    await flushConnect();
    await flushConnect();
    const es = MockEventSource.last!;
    act(() => es.fireOpen());
    act(() => vi.advanceTimersByTime(250));

    expect(result.current.stage).toBe('spectating');
    expect(result.current.isSpectator).toBe(true);
  });

  it('spectate 命令 404 时设置 notFound(房间不存在)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.joinAsSpectator('GHOST-ROOM'));
    await flushConnect();
    expect(result.current.notFound).toBe(true);
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

  it('createRoom 期间 isCreating 为 true,创建 settle 后复位(防重复提交)', async () => {
    // 用可控 Promise 挂起 POST /api/rooms,验证请求在途时 isCreating 保持 true
    let resolveCreate: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        if (url.endsWith('/api/rooms') && opts?.method === 'POST') {
          return new Promise<Response>((res) => {
            resolveCreate = res;
          });
        }
        return new Response('{}', { status: 200 });
      }),
    );
    const { result } = renderHook(() => useMultiplayerRoom());
    expect(result.current.isCreating).toBe(false);
    act(() => result.current.createRoom('房', 2));
    expect(result.current.isCreating).toBe(true);
    await act(async () => {
      resolveCreate(
        new Response(JSON.stringify({ roomId: 'ROOM1', playerId: 'pid-0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      // fetch/then 链跨多个微任务,多轮刷新确保 finally 执行
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isCreating).toBe(false);
    expect(result.current.stage).toBe('waiting');
  });

  it('createRoom 失败(500)后 isCreating 复位并回到 lobby', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: '创建失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('房', 2));
    await flushConnect();
    expect(result.current.isCreating).toBe(false);
    expect(result.current.stage).toBe('lobby');
    expect(result.current.error).toBe('创建失败');
  });

  it('autoJoin 房间不存在(文案命中,无 status 属性)时也设置 notFound(isRoomNotFound 文案兜底)', async () => {
    // 模拟错误只有文案没有 status 属性的兜底路径:isRoomNotFound 应按「房间不存在」文案命中
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('房间不存在或已关闭');
    }));
    const { result } = renderHook(() => useMultiplayerRoom('GHOST-ROOM'));
    await flushConnect();
    expect(result.current.notFound).toBe(true);
  });

  // ─── 录像服务端导出(downloadLatestReplay) ───

  /** 构造一条历史条目(字段与服务端 GameHistoryEntry 对齐,列表接口只消费 id) */
  function makeHistoryEntry(id: string) {
    return {
      id,
      roomId: 'ROOM1',
      roomName: '测试房',
      gameMode: '身份局',
      startedAt: 1,
      endedAt: 2,
      endedReason: '正常',
      winnerLabel: '主公方',
      players: [],
      hasReplay: true,
    };
  }

  it('downloadLatestReplay:历史列表含条目时请求最新录像的 download URL', async () => {
    const fetchedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      return new Response(JSON.stringify({ entries: [makeHistoryEntry('entry-9')] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    // 录像下载通过 anchor href 触发浏览器下载(?download=1,Content-Disposition 由服务端
    // 设置),不走 fetch;spy anchor.click 捕获生成的下载 href 作为等价断言
    const clickedHrefs: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedHrefs.push(this.href);
      });

    const ok = await downloadLatestReplay('ROOM1');

    expect(ok).toBe(true);
    expect(fetchedUrls).toContain('/api/rooms/ROOM1/history');
    // jsdom 把相对 href 解析为绝对地址;最新条目(时间降序 entries[0])触发下载
    expect(clickedHrefs).toEqual([
      `${window.location.origin}/api/rooms/ROOM1/history/entry-9?download=1`,
    ]);
    clickSpy.mockRestore();
  });

  it('downloadLatestReplay:录像尚未落盘(列表持续为空)时重试 5 次后返回 false', async () => {
    const fetchedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const pending = downloadLatestReplay('ROOM1');
    // 4 次重试间隔 500ms,推进足够时间让轮询链走完
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const ok = await pending;

    expect(ok).toBe(false);
    expect(fetchedUrls.length).toBe(5);
  });
});
