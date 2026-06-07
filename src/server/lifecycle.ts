// server/lifecycle.ts
import type { Server } from 'http';
import { flushPendingWrites } from './persistence';
import { shutdownAll } from './lifecycles';
import { createLogger } from './logger';

const log = createLogger('lifecycle');

const SHUTDOWN_TIMEOUT_MS = 10_000;
let isShuttingDown = false;

function shutdown(server: { close: (callback?: () => void) => void }, signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`收到 ${signal}，开始优雅关闭...`);

  const forceExit = setTimeout(() => {
    log.error('优雅关闭超时，强制退出');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(async () => {
    log.info('HTTP 服务器已关闭');
    try {
      await flushPendingWrites();
      log.info('持久化数据已刷新');
    } catch (err) {
      log.error('刷新持久化数据失败', { error: String(err) });
    }
    try {
      await shutdownAll();
    } catch (err) {
      log.error('关闭注册资源失败', { error: String(err) });
    }
    log.info('优雅关闭完成');
    process.exit(0);
  });
}

export function setupGracefulShutdown(server: { close: (callback?: () => void) => void }): void {
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(server, 'SIGINT'));
}
