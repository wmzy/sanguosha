// tests/headless/HeadlessGameClient.requests.test.ts
// HGC 受保护 REST 请求回归：Bearer 透传、HTTP 错误可观察且只报告一次。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';


class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = MockEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() { this.readyState = MockEventSource.CLOSED; }
}


describe('HeadlessGameClient 受保护 REST 请求', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('action HTTP 401 同时进入拒绝和错误通道且不重复上报', async () => {
    const errors: Error[] = [];
    const rejected: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/join')) {
        return new Response(JSON.stringify({ roomId: 'ROOM', playerId: 'P1' }), { status: 200 });
      }
      if (url.endsWith('/action')) {
        return new Response(JSON.stringify({ error: '请先登录' }), { status: 401 });
      }
      return new Response('{}', { status: 200 });
    }));

    const hgc = new HeadlessGameClient(
      'http://test',
      { onError: (error) => errors.push(error), onActionRejected: () => rejected.push(1) },
      { token: 'expired-token' },
    );
    await hgc.joinRoom('ROOM', 'P1');
    hgc.sendAction({ skillId: '杀', actionType: 'use', ownerId: 0, params: {}, baseSeq: 0 });
    await vi.waitFor(() => expect(errors).toHaveLength(1));

    expect(hgc.consumeActionRejected()).toBe(true);
    expect(hgc.consumeActionRejected()).toBe(false);
    expect(rejected).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('请先登录');
    expect((errors[0] as Error & { status?: number }).status).toBe(401);
    hgc.disconnect();
  });
});
