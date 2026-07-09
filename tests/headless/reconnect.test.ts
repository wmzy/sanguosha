// tests/headless/reconnect.test.ts
// HeadlessGameClient 指数退避重连机制的单元测试。
// 使用 MockWebSocket + vi.useFakeTimers 控制连接/断开/退避时序。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import type { ReconnectState } from '../../src/client/headless/types';

// ── Mock WebSocket ──
let createdWS: MockWebSocket[];

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    createdWS.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  // ── 测试辅助方法 ──
  fireOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  fireMessage(data: string): void {
    this.onmessage?.({ data });
  }

  fireClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }
}

function makeRoomJoined(roomId: string, playerId: string, seatIndex?: number): string {
  return JSON.stringify(
    seatIndex !== undefined
      ? { type: 'room_joined', roomId, playerId, seatIndex }
      : { type: 'room_joined', roomId, playerId },
  );
}

describe('HeadlessGameClient 重连机制', () => {
  beforeEach(() => {
    createdWS = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── 基础重连流程 ──

  it('意外断线后自动发起重连', () => {
    const states: Array<{ state: ReconnectState; attempt: number }> = [];
    const hgc = new HeadlessGameClient('ws://test/ws', {
      onReconnectStateChange: (state, attempt) => states.push({ state, attempt }),
    });

    // 建立连接
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    expect(hgc.reconnectState).toBe('idle');

    // 意外断线
    createdWS[0].fireClose();

    expect(hgc.reconnectState).toBe('reconnecting');
    expect(states).toContainEqual({ state: 'reconnecting', attempt: 1 });
  });

  it('重连成功后发送 reconnect 消息并恢复状态', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    createdWS[0].fireClose();

    // 第一次重连(1s 后)
    vi.advanceTimersByTime(1000);
    expect(createdWS.length).toBe(2);
    createdWS[1].fireOpen();

    // 验证发送了 reconnect 消息
    const sent = createdWS[1].sentMessages.map((s) => JSON.parse(s));
    const reconnectMsg = sent.find((m) => m.type === 'reconnect');
    expect(reconnectMsg).toBeDefined();
    expect(reconnectMsg!.playerId).toBe('P1');

    // 收到 room_joined → 重连成功
    createdWS[1].fireMessage(makeRoomJoined('ROOM', 'P1-new'));
    expect(hgc.reconnectState).toBe('idle');
    expect(hgc.playerId).toBe('P1-new');
  });

  it('debug 模式重连发送 join_debug_room 消息', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.connect('DEBUG', 2); // debug 模式
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('DEBUG', 'P0', 2));
    createdWS[0].fireClose();

    vi.advanceTimersByTime(1000);
    createdWS[1].fireOpen();

    const sent = createdWS[1].sentMessages.map((s) => JSON.parse(s));
    const joinMsg = sent.find((m) => m.type === 'join_debug_room');
    expect(joinMsg).toBeDefined();
    expect(joinMsg!.roomId).toBe('DEBUG');
    expect(joinMsg!.lastSeq).toBe(0);
  });

  // ── 指数退避 ──

  it('指数退避延迟:1s→2s→4s→8s→16s→30s(cap)', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('ROOM', 'P1'));

    // 触发断线
    createdWS[0].fireClose();

    // 第 1 次:1s 后
    vi.advanceTimersByTime(999);
    expect(createdWS.length).toBe(1); // 未到 1s
    vi.advanceTimersByTime(1);
    expect(createdWS.length).toBe(2); // 1s 到 → 创建新 WS
    createdWS[1].fireClose();

    // 第 2 次:2s 后
    vi.advanceTimersByTime(1999);
    expect(createdWS.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(createdWS.length).toBe(3);
    createdWS[2].fireClose();

    // 第 3 次:4s 后
    vi.advanceTimersByTime(3999);
    expect(createdWS.length).toBe(3);
    vi.advanceTimersByTime(1);
    expect(createdWS.length).toBe(4);
    createdWS[3].fireClose();

    // 第 4 次:8s 后
    vi.advanceTimersByTime(7999);
    expect(createdWS.length).toBe(4);
    vi.advanceTimersByTime(1);
    expect(createdWS.length).toBe(5);
    createdWS[4].fireClose();

    // 第 5 次:16s 后
    vi.advanceTimersByTime(15999);
    expect(createdWS.length).toBe(5);
    vi.advanceTimersByTime(1);
    expect(createdWS.length).toBe(6);
    createdWS[5].fireClose();

    // 第 6 次:30s(cap,2^5=32→30)
    vi.advanceTimersByTime(29999);
    expect(createdWS.length).toBe(6);
    vi.advanceTimersByTime(1);
    expect(createdWS.length).toBe(7);
  });

  // ── 最大重试次数 ──

  it('达到最大重试次数(10)后标记为 failed', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    createdWS[0].fireClose();

    // 连续失败 10 次
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(60000); // 超过最大退避
      const ws = createdWS[createdWS.length - 1];
      ws.fireClose();
    }

    expect(hgc.reconnectState).toBe('failed');
  });

  // ── 主动断开不重连 ──

  it('disconnect() 不触发重连', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('ROOM', 'P1'));

    hgc.disconnect();

    vi.advanceTimersByTime(60000);
    expect(hgc.reconnectState).toBe('idle');
    expect(createdWS.length).toBe(1); // 没有重连
  });

  // ── 用户手动取消 ──

  it('cancelReconnect() 停止正在进行的重连', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    createdWS[0].fireClose();

    expect(hgc.reconnectState).toBe('reconnecting');

    hgc.cancelReconnect();
    expect(hgc.reconnectState).toBe('idle');

    // 确认定时器已清除
    vi.advanceTimersByTime(60000);
    expect(createdWS.length).toBe(1); // 没有创建重连 WS
  });

  // ── 未收到 room_joined 不重连 ──

  it('room_joined 前断线不触发重连(无重连上下文)', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    // 未收到 room_joined 就断线
    createdWS[0].fireClose();

    expect(hgc.reconnectState).toBe('idle');
    vi.advanceTimersByTime(60000);
    expect(createdWS.length).toBe(1);
  });

  // ── 重连后 view 恢复 ──

  it('重连后收到 initialView 恢复 view 状态', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    createdWS[0].fireClose();

    vi.advanceTimersByTime(1000);
    createdWS[1].fireOpen();
    createdWS[1].fireMessage(makeRoomJoined('ROOM', 'P1-new'));

    // 模拟服务端发送 initialView
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
    createdWS[1].fireMessage(
      JSON.stringify({ type: 'initialView', state: mockView, lastSeq: 42 }),
    );

    expect(hgc.view).not.toBeNull();
    expect(hgc.view!.viewer).toBe(0);
    expect(hgc.lastSeq).toBe(42);
    expect(hgc.reconnectState).toBe('idle');
  });

  // ── 消息缓冲 ──

  it('断线期间发送的消息在重连后 flush', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    createdWS[0].fireClose();

    // 断线期间发送消息(缓冲)
    hgc.sendReady();

    vi.advanceTimersByTime(1000);
    createdWS[1].fireOpen();
    createdWS[1].fireMessage(makeRoomJoined('ROOM', 'P1-new'));

    // outbox 应已 flush
    const sent = createdWS[1].sentMessages.map((s) => JSON.parse(s));
    const readyMsg = sent.find((m) => m.type === 'ready');
    expect(readyMsg).toBeDefined();
  });

  // ── 二次重连使用新 playerId ──

  it('第一次重连成功后,第二次重连使用新的 playerId', () => {
    const hgc = new HeadlessGameClient('ws://test/ws');
    hgc.joinRoom('ROOM', 'P1');
    createdWS[0].fireOpen();
    createdWS[0].fireMessage(makeRoomJoined('ROOM', 'P1'));
    createdWS[0].fireClose();

    // 第一次重连
    vi.advanceTimersByTime(1000);
    createdWS[1].fireOpen();
    createdWS[1].fireMessage(makeRoomJoined('ROOM', 'P1-new'));

    // 第二次断线+重连
    createdWS[1].fireClose();
    vi.advanceTimersByTime(1000);
    createdWS[2].fireOpen();

    const sent = createdWS[2].sentMessages.map((s) => JSON.parse(s));
    const reconnectMsg = sent.find((m) => m.type === 'reconnect');
    expect(reconnectMsg).toBeDefined();
    // 使用第一次重连后更新的 playerId
    expect(reconnectMsg!.playerId).toBe('P1-new');
  });
});
