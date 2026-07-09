// @vitest-environment jsdom
// tests/client/useMultiplayerRoom.test.tsx
// useMultiplayerRoom hook 单元测试:验证多人模式连接生命周期与「再来一局」状态流转。
//
// 放置说明:useMultiplayerRoom 是多人模式核心 hook(非 skill、非 integration),现有无对应
// hook 测试文件,故新建 tests/client/useMultiplayerRoom.test.tsx。聚焦多人模式特有逻辑
// (createRoom/joinRoom/ready/startGame/restart/game_reset 状态清除),与 Debug 模式对称。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiplayerRoom } from '../../src/client/hooks/useMultiplayerRoom';
import type { GameView } from '../../src/engine/types';
import { DEFAULT_ROOM_CONFIG, type ServerMessage } from '../../src/server/protocol';

/** 可控的 WebSocket mock:测试驱动 onopen/onmessage,捕获 send 调用。 */
class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: MockWebSocket | null = null;
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly readyState = 1; // OPEN
  sent: any[] = [];
  closed = false;

  constructor(public url: string) {
    MockWebSocket.last = this;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
  }

  /** 测试驱动:模拟服务端推送消息 */
  emit(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  static reset() {
    MockWebSocket.last = null;
    MockWebSocket.instances = [];
  }
}

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
    MockWebSocket.reset();
    (globalThis as any).WebSocket = MockWebSocket;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** 推送消息并推进轮询定时器(同步 hgc.roomId/playerId 到 React state)。 */
  function emitAndSync(ws: MockWebSocket, msg: ServerMessage) {
    act(() => ws.emit(msg));
    act(() => {
      vi.advanceTimersByTime(250);
    });
  }

  it('createRoom 后收到 room_joined 进入 waiting 阶段', async () => {
    const { result } = renderHook(() => useMultiplayerRoom());

    act(() => {
      result.current.createRoom('测试房', 2);
    });
    // openSocket 创建 MockWebSocket,但 onopen 在真实环境异步;手动触发
    const ws = MockWebSocket.last!;
    act(() => {
      ws.onopen?.();
    });
    // flush outbox(create_room 消息)
    emitAndSync(ws, { type: 'room_joined', roomId: 'ROOM1', playerId: 'pid-0', seatIndex: 0 });

    expect(result.current.stage).toBe('waiting');
    expect(result.current.roomId).toBe('ROOM1');
    expect(result.current.playerId).toBe('pid-0');
  });

  it('再来一局:sendRestart 发送 restart_game 消息', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());

    act(() => result.current.sendRestart());

    expect(ws.sent.some((m) => m.type === 'restart_game')).toBe(true);
  });

  it('game_reset 后从 ended 回到 waiting,清除 gameOver/view,ready 复位', () => {
    const { result } = renderHook(() => useMultiplayerRoom());

    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    // 进入房间
    emitAndSync(ws, { type: 'room_joined', roomId: 'ROOM1', playerId: 'pid-0', seatIndex: 0 });
    // 开局进入对局
    act(() => ws.emit({ type: 'game_started' }));
    act(() => ws.emit({ type: 'initialView', state: makeBaseline(0), lastSeq: 3 }));
    expect(result.current.stage).toBe('playing');
    // 游戏结束
    act(() => ws.emit({ type: 'gameOver', winner: '主公阵营' }));
    expect(result.current.stage).toBe('ended');
    expect(result.current.gameOver).toEqual({ winner: '主公阵营' });

    // 再来一局:服务端 resetToLobby 后广播 game_reset
    act(() => ws.emit({ type: 'game_reset' }));

    expect(result.current.stage).toBe('waiting');
    expect(result.current.gameOver).toBeNull();
    expect(result.current.view).toBeNull();
    expect(result.current.ready).toBe(false);
  });

  it('game_reset 后保留 roomId/playerId(未退出房间)', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    emitAndSync(ws, { type: 'room_joined', roomId: 'ROOM1', playerId: 'pid-0', seatIndex: 0 });
    act(() => ws.emit({ type: 'game_started' }));
    act(() => ws.emit({ type: 'initialView', state: makeBaseline(0), lastSeq: 1 }));
    act(() => ws.emit({ type: 'gameOver', winner: '主公阵营' }));

    act(() => ws.emit({ type: 'game_reset' }));

    // 回到准备阶段但仍在同一房间
    expect(result.current.roomId).toBe('ROOM1');
    expect(result.current.playerId).toBe('pid-0');
  });

  // ─── 连接命令与入座路径 ───

  it('joinRoom 显式加入房间后 open 发送 join_room', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.joinRoom('ROOM-JOIN'));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    expect(ws.sent.some((m) => m.type === 'join_room' && m.roomId === 'ROOM-JOIN')).toBe(true);
  });

  it('initialRoomId 提供时自动 join(分享链接直达)', () => {
    renderHook(() => useMultiplayerRoom('ROOM-DEEPLINK'));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    expect(ws.sent.some((m) => m.type === 'join_room' && m.roomId === 'ROOM-DEEPLINK')).toBe(true);
  });

  it('createRoom 空名时生成默认房间名', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    const create = ws.sent.find((m) => m.type === 'create_room');
    expect(create).toBeTruthy();
    // 默认名形如 "房间XXXX"
    expect((create as { name: string }).name).toMatch(/^房间[A-Z0-9]+$/);
  });

  it('createRoom 携带 config 时透传到 create_room 消息', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() =>
      result.current.createRoom('房', 2, { ...DEFAULT_ROOM_CONFIG, timeoutScale: 2 }),
    );
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    const create = ws.sent.find((m) => m.type === 'create_room') as {
      config?: { timeoutScale: number };
    };
    expect(create.config?.timeoutScale).toBe(2);
  });

  // ─── 房间状态与准备/开局 ───

  it('room_state 同步后 isHost 在房主本人座次为 true', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    emitAndSync(ws, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    emitAndSync(ws, {
      type: 'room_state',
      readyPlayers: [],
      playerIds: ['pid-0'],
      hostId: 'pid-0',
      maxPlayers: 2,
      config: DEFAULT_ROOM_CONFIG,
    });
    expect(result.current.isHost).toBe(true);
    expect(result.current.roomState?.hostId).toBe('pid-0');
  });

  it('toggleReady 发送 ready 并置 ready=true', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    emitAndSync(ws, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    act(() => result.current.toggleReady());
    expect(ws.sent.some((m) => m.type === 'ready')).toBe(true);
    expect(result.current.ready).toBe(true);
  });

  it('startGame 发送 start_game', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    emitAndSync(ws, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    act(() => result.current.startGame());
    expect(ws.sent.some((m) => m.type === 'start_game')).toBe(true);
  });

  // ─── 错误处理 ───

  it('收到 error 消息后 setError,3 秒后自动清除', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    emitAndSync(ws, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    act(() => ws.emit({ type: 'error', message: '房间已满' }));
    expect(result.current.error).toBe('房间已满');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.error).toBeNull();
  });

  it('gameOver 消息设置 gameOver.winner', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    emitAndSync(ws, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
    act(() => ws.emit({ type: 'gameOver', winner: '反贼阵营' }));
    expect(result.current.gameOver).toEqual({ winner: '反贼阵营' });
    expect(result.current.stage).toBe('ended');
  });

  // ─── 离开与无连接守卫 ───

  it('leaveRoom 回到 lobby,清空全部房间状态,并断开连接', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    emitAndSync(ws, { type: 'room_joined', roomId: 'ROOM1', playerId: 'pid-0', seatIndex: 0 });
    expect(result.current.stage).toBe('waiting');

    act(() => result.current.leaveRoom());

    expect(result.current.stage).toBe('lobby');
    expect(result.current.roomId).toBeNull();
    expect(result.current.playerId).toBeNull();
    expect(result.current.roomState).toBeNull();
    expect(result.current.view).toBeNull();
    expect(result.current.ready).toBe(false);
    // 原连接被断开
    expect(ws.closed).toBe(true);
  });

  it('leaveRoom 后(无连接)toggleReady/startGame/sendAction/reorderHand 均为 no-op', () => {
    const { result } = renderHook(() => useMultiplayerRoom());
    act(() => result.current.createRoom('测试房', 2));
    const ws = MockWebSocket.last!;
    act(() => ws.onopen?.());
    emitAndSync(ws, { type: 'room_joined', roomId: 'R', playerId: 'pid-0', seatIndex: 0 });
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
    // 断开后无新消息发出
    expect(ws.sent.some((m) => m.type === 'ready')).toBe(false);
  });
});
