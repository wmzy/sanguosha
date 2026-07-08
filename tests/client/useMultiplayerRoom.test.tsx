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
import type { ServerMessage } from '../../src/server/protocol';

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
});
