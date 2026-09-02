// tests/server/lifecycle.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('setupGracefulShutdown', () => {
  const listeners: { signal: string; handler: () => void }[] = [];

  /** 排空 shutdown 异步链。
   *  handler 触发的 server.close 回调是异步链(flushPendingWrites → shutdownAll →
   *  closeRoomStore → process.exit)。vitest 配置 clearMocks/restoreMocks 在测试结束
   *  后恢复 mock——若链尚未走完,迟到的真实 process.exit(0) 会直接杀死 vitest fork
   *  worker(forks 池下 process.exit 终止整个子进程;threads 池仅终止当前线程,故
     *  threads 池不复现),表现为 `npm test`(core 项目合跑)静默退出 EXIT=0、无任何
   *  报告输出的假绿。isolate:false 下该泄漏跨文件致命且随文件→worker 分配非确定性
   *  触发(engine/server/integration 三目录合跑必现)。链各环节在未 init DB 时均为
   *  微任务级,固定排空宏任务即可保证 exit(mock) 在 restore 前完成。 */
  async function drainShutdownChain(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

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

  afterEach(async () => {
    await drainShutdownChain();
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
