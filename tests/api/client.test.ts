import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiError } from '../../src/client/api/client';

function mockFetch(response: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  return vi.fn().mockResolvedValue(response);
}

describe('apiFetch', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('成功请求并解析 JSON', async () => {
    globalThis.fetch = mockFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ roomId: 'abc123' }),
    });

    const result = await apiFetch<{ roomId: string }>('/api/rooms');
    expect(result).toEqual({ roomId: 'abc123' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/rooms',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('4xx 错误抛出 ApiError', async () => {
    const errorBody = { error: '房间已满' };
    globalThis.fetch = mockFetch({
      ok: false,
      status: 400,
      json: () => Promise.resolve(errorBody),
    });

    const err = await apiFetch('/api/rooms').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).body).toEqual(errorBody);
    expect((err as ApiError).message).toBe('API Error: 400');
  });

  it('5xx 错误抛出 ApiError', async () => {
    globalThis.fetch = mockFetch({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal Server Error' }),
    });

    const err = await apiFetch('/api/rooms').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });

  it('AbortController 取消请求', async () => {
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = vi
      .fn()
      .mockImplementation((_url: string, options: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          if (options.signal.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          }
        });
      });

    await expect(apiFetch('/api/rooms', { signal: controller.signal })).rejects.toThrow();
  });

  it('超时自动中止请求', async () => {
    vi.useFakeTimers();

    globalThis.fetch = vi
      .fn()
      .mockImplementation((_url: string, options: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });

    const promise = apiFetch('/api/rooms', { timeout: 1000 });

    vi.advanceTimersByTime(1000);

    await expect(promise).rejects.toThrow();

    vi.useRealTimers();
  });
});
