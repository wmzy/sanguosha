// tests/server/lifecycle.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('setupGracefulShutdown', () => {
  const listeners: { signal: string; handler: () => void }[] = [];

  beforeEach(() => {
    listeners.length = 0;
    vi.spyOn(process, 'on').mockImplementation(((
      signal: string | symbol,
      handler: (...args: unknown[]) => void,
    ) => {
      listeners.push({ signal: String(signal), handler });
      return process;
    }) as never);
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register SIGTERM and SIGINT handlers', async () => {
    const { setupGracefulShutdown } = await import('../../src/server/lifecycle');
    const mockServer = { close: vi.fn((cb?: () => void) => cb?.()) };
    setupGracefulShutdown(mockServer);
    const signals = listeners.map((l) => l.signal);
    expect(signals).toContain('SIGTERM');
    expect(signals).toContain('SIGINT');
  });

  it('should call server.close on SIGTERM', async () => {
    const { setupGracefulShutdown } = await import('../../src/server/lifecycle');
    const mockServer = { close: vi.fn((cb?: () => void) => cb?.()) };
    setupGracefulShutdown(mockServer);
    const handler = listeners.find((l) => l.signal === 'SIGTERM')?.handler;
    expect(handler).toBeDefined();
    handler!();
    expect(mockServer.close).toHaveBeenCalled();
  });

  it('should call process.exit(0) after server closes', async () => {
    vi.resetModules();
    const { setupGracefulShutdown } = await import('../../src/server/lifecycle');
    const mockServer = { close: vi.fn((cb?: () => void) => cb?.()) };
    setupGracefulShutdown(mockServer);
    const handler = listeners.find((l) => l.signal === 'SIGINT')?.handler;
    handler!();
    await new Promise((resolve) => setImmediate(resolve));
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should ignore duplicate shutdown signals', async () => {
    vi.resetModules();
    const { setupGracefulShutdown } = await import('../../src/server/lifecycle');
    const mockServer = { close: vi.fn((cb?: () => void) => cb?.()) };
    setupGracefulShutdown(mockServer);
    const handler = listeners.find((l) => l.signal === 'SIGTERM')?.handler;
    handler!();
    handler!();
    expect(mockServer.close).toHaveBeenCalledTimes(1);
  });
});
