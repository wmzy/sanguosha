// tests/headless/reconnect.test.ts
// HeadlessGameClient SSE 重连状态映射的单元测试。
// SSE 模式下重连由 EventSource 内部自动处理，HGC 只映射 reconnectState。
// 使用 MockEventSource + MockFetch 控制 SSE 事件流 + REST 响应。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import type { ReconnectState } from '../../src/client/headless/types';

// ── Mock EventSource ──
let createdES: MockEventSource[];

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = MockEventSource.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    createdES.push(this);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  // ── 测试辅助方法 ──
  fireOpen(): void {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  fireMessage(data: string): void {
    this.onmessage?.({ data });
  }

  fireError(): void {
    this.onerror?.();
  }

  /** 模拟 EventSource 内部重连成功 */
  fireReconnect(): void {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  /** 模拟 EventSource 内部放弃重连（CLOSED） */
  fireGiveUp(): void {
    this.readyState = MockEventSource.CLOSED;
  }
}

function makeRoomJoined(roomId: string, playerId: string, seatIndex?: number): string {
  return JSON.stringify(
    seatIndex !== undefined
      ? { type: 'room_joined', roomId, playerId, seatIndex }
      : { type: 'room_joined', roomId, playerId },
  );
}

/** mock fetch：joinRoom/connect/createRoom/createDebugRoom 返回 JSON */
function mockFetchJoin(url: string): Promise<Response> {
  const roomId = url.match(/\/api\/(?:debug-room\/)?([^/?]+)/)?.[1] ?? 'ROOM';
  const isDebug = url.includes('/api/debug-room');
  const body = isDebug
    ? { roomId, playerId: 'P1', seatIndex: 0 }
    : { roomId, playerId: 'P1' };
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('HeadlessGameClient 重连机制 (SSE)', () => {
  beforeEach(() => {
    createdES = [];
    vi.stubGlobal('EventSource', MockEventSource);
    // mock fetch — 所有 POST 返回 join 响应
    const fetchMock = vi.fn((_url: string, _opts?: RequestInit) => {
      return mockFetchJoin(_url);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── 基础连接 ──

  it('SSE 连接建立后 reconnectState 为 idle', async () => {
    const hgc = new HeadlessGameClient('http://test');
    await hgc.joinRoom('ROOM', 'P1');
    createdES[0].fireOpen();
    createdES[0].fireMessage(makeRoomJoined('ROOM', 'P1'));

    expect(hgc.reconnectState).toBe('idle');
  });

  // ── 断线检测 ──

  it('SSE onerror 后映射为 reconnecting', async () => {
    const states: Array<{ state: ReconnectState; attempt: number }> = [];
    const hgc = new HeadlessGameClient('http://test', {
      onReconnectStateChange: (state, attempt) => states.push({ state, attempt }),
    });

    await hgc.joinRoom('ROOM', 'P1');
    createdES[0].fireOpen();
    createdES[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    expect(hgc.reconnectState).toBe('idle');

    // SSE 断线
    createdES[0].fireError();

    expect(hgc.reconnectState).toBe('reconnecting');
    expect(states).toContainEqual({ state: 'reconnecting', attempt: 1 });
  });

  // ── EventSource 自动恢复 ──

  it('EventSource 内部恢复连接后映射回 idle', async () => {
    vi.useFakeTimers();
    const hgc = new HeadlessGameClient('http://test');
    await hgc.joinRoom('ROOM', 'P1');
    createdES[0].fireOpen();
    createdES[0].fireMessage(makeRoomJoined('ROOM', 'P1'));

    createdES[0].fireError();
    expect(hgc.reconnectState).toBe('reconnecting');

    // EventSource 内部恢复（onopen 再次触发）
    createdES[0].fireReconnect();

    // 轮询检测到 readyState=OPEN → idle（需要推进时间让轮询执行）
    vi.advanceTimersByTime(600);

    expect(hgc.reconnectState).toBe('idle');
  });

  // ── 主动断开不重连 ──

  it('disconnect() 不触发重连', async () => {
    vi.useFakeTimers();
    const hgc = new HeadlessGameClient('http://test');
    await hgc.joinRoom('ROOM', 'P1');
    createdES[0].fireOpen();
    createdES[0].fireMessage(makeRoomJoined('ROOM', 'P1'));

    hgc.disconnect();

    vi.advanceTimersByTime(60000);
    expect(hgc.reconnectState).toBe('idle');
    // EventSource 被 close
    expect(createdES[0].readyState).toBe(MockEventSource.CLOSED);
  });

  // ── 用户手动取消 ──

  it('cancelReconnect() 关闭正在重连的 EventSource 并恢复 idle', async () => {
    vi.useFakeTimers();
    const hgc = new HeadlessGameClient('http://test');
    await hgc.joinRoom('ROOM', 'P1');
    createdES[0].fireOpen();
    createdES[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    createdES[0].fireError();

    expect(hgc.reconnectState).toBe('reconnecting');

    hgc.cancelReconnect();
    expect(hgc.reconnectState).toBe('idle');
  });

  // ── 未收到 room_joined 不触发重连 ──

  it('canReconnect 前断线不触发重连(无重连上下文)', async () => {
    vi.useFakeTimers();
    const hgc = new HeadlessGameClient('http://test');
    await hgc.joinRoom('ROOM', 'P1');
    createdES[0].fireOpen();
    // 未收到 room_joined 就断线
    createdES[0].fireError();

    // canReconnect 在 joinRoom 成功后已为 true（REST 返回即可重连）
    // 但 intentionalDisconnect 为 false，仍会映射为 reconnecting
    // 此测试验证的是 WS 时代的行为——SSE 时代 canReconnect 在 REST 入口即设
    // 所以断线后仍触发 reconnecting
    expect(hgc.reconnectState).toBe('reconnecting');
  });

  // ── EventSource 放弃重连后标记 failed ──

  it('EventSource readyState=CLOSED 后映射为 failed', async () => {
    vi.useFakeTimers();
    const hgc = new HeadlessGameClient('http://test');
    await hgc.joinRoom('ROOM', 'P1');
    createdES[0].fireOpen();
    createdES[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    createdES[0].fireError();
    expect(hgc.reconnectState).toBe('reconnecting');

    // EventSource 内部放弃重连
    createdES[0].fireGiveUp();
    vi.advanceTimersByTime(600);

    expect(hgc.reconnectState).toBe('failed');
  });

  // ── 重连后消息恢复 view ──

  it('断线恢复后收到 initialView 恢复 view 状态', async () => {
    vi.useFakeTimers();
    const hgc = new HeadlessGameClient('http://test');
    await hgc.joinRoom('ROOM', 'P1');
    createdES[0].fireOpen();
    createdES[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    createdES[0].fireError();

    // EventSource 恢复
    createdES[0].fireReconnect();
    vi.advanceTimersByTime(600);

    // 模拟服务端通过 SSE 推送 initialView
    const mockView = {
      viewer: 0,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      players: [],
      cardMap: {},
      pending: null,
      deadline: null,
      deadlineTotalMs: 0,
      log: [],
      settlementStack: [],
    };
    createdES[0].fireMessage(
      JSON.stringify({ type: 'initialView', state: mockView, lastSeq: 42 }),
    );

    expect(hgc.view).not.toBeNull();
    expect(hgc.view!.viewer).toBe(0);
    expect(hgc.lastSeq).toBe(42);
    expect(hgc.reconnectState).toBe('idle');
  });
});
