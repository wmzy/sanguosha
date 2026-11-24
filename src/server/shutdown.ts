// server/shutdown.ts

import { flushPendingWrites } from './persistence';
import { shutdownAll } from './resourceRegistry';
import { closeRoomStore } from './roomStore';
import { createLogger } from './logger';

const log = createLogger('shutdown');

/** 优雅关闭兜底超时:超时即强制退出。dev(vite-plugin)与生产(index.ts)统一取
 *  10s,两条入口行为一致(有意变更:原 dev 入口为 6s)。 */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

let isShuttingDown = false;

/** 清理步骤清单:三步依次执行,单步失败仅记日志、不阻断后续步骤。 */
export interface GracefulShutdownLoaders {
  flushPendingWrites: () => Promise<void>;
  shutdownAll: () => Promise<void>;
  closeRoomStore: () => Promise<void>;
}

/** 优雅关闭的单一实现:超时强退兜底 + 可选的 HTTP 关闭前置步骤 + 三步清理。
 *  生产入口(index.ts → setupGracefulShutdown)直接传入静态导入的三个函数;
 *  dev 入口(vite-plugin)经 ssrLoadModule 反射加载各模块后构造 loaders 调用
 *  (反射加载保留为 loader 参数,见 vite-plugin.ts 文件头注释)。
 *  步骤顺序两条入口一致:先关 HTTP(排空在途请求)→ 刷盘 → 关注册资源 → 关 DB。 */
export async function runGracefulShutdown(
  loaders: GracefulShutdownLoaders,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
  preClose?: () => Promise<void>,
): Promise<void> {
  // 强退兜底必须在任何 await 之前武装:SSE 长连接会让 server.close 回调(经
  // preClose 等待)永不到来,超时强退是这种情况下的唯一出口。
  const forceExit = setTimeout(() => {
    log.error('优雅关闭超时，强制退出');
    process.exit(1);
  }, timeoutMs);
  forceExit.unref();

  try {
    if (preClose) {
      try {
        await preClose();
      } catch (err) {
        log.error('HTTP 服务器关闭失败', { error: String(err) });
      }
    }
    try {
      await loaders.flushPendingWrites();
      log.info('持久化数据已刷新');
    } catch (err) {
      log.error('刷新持久化数据失败', { error: String(err) });
    }
    try {
      await loaders.shutdownAll();
    } catch (err) {
      log.error('关闭注册资源失败', { error: String(err) });
    }
    try {
      // 显式关闭 PGlite 连接,刷 WAL + 清 postmaster.pid,避免脏关闭。
      await loaders.closeRoomStore();
    } catch (err) {
      log.error('关闭 DB 连接失败', { error: String(err) });
    }
    log.info('优雅关闭完成');
  } finally {
    clearTimeout(forceExit);
  }
}

function shutdown(server: { close: (callback?: () => void) => void }, signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`收到 ${signal}，开始优雅关闭...`);

  void runGracefulShutdown(
    { flushPendingWrites, shutdownAll, closeRoomStore },
    SHUTDOWN_TIMEOUT_MS,
    // 先等 HTTP server 关闭再清理(与原实现一致);连接排空期间超时兜底持续生效。
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          log.info('HTTP 服务器已关闭');
          resolve();
        });
      }),
  ).then(() => process.exit(0));
}

export function setupGracefulShutdown(server: { close: (callback?: () => void) => void }): void {
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(server, 'SIGINT'));
}

let processHandlersInstalled = false;

/** 进程级兜底:未捕获异常 / 未处理的 Promise 拒绝 → 记日志 + 走同一套优雅关闭 → 退出(1)。
 *  不装的后果:Node 22 默认 unhandled-rejections=throw,任何遗漏的 fire-and-forget 拒绝
 *  直接杀进程并跳过刷盘(PGlite 脏关闭,下次启动要 crash recovery)。
 *  安装点必须是真实进程入口(index.ts / vite-plugin.configureServer):
 *  本模块会被大量测试 import,模块顶层安装会污染测试进程。幂等。 */
export function installProcessErrorHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  const fatal = (label: string, err: unknown): void => {
    log.error(`未捕获的${label}，开始优雅关闭`, {
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    });
    void runGracefulShutdown({
      flushPendingWrites,
      shutdownAll,
      closeRoomStore,
    })
      .catch(() => {
        /* 清理失败也必须退出(超时兜底会强退) */
      })
      .finally(() => process.exit(1));
  };
  process.on('uncaughtException', (err) => fatal('异常', err));
  process.on('unhandledRejection', (reason) => fatal('Promise 拒绝', reason));
}
