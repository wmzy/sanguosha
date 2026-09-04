// server/vite-plugin.ts
// Vite dev server 插件:把 Hono REST API 挂载到 Vite 的 HTTP server 上。
// 单端口模式:前端和后端共享 3930 端口。
//
// ⚠️ 本文件必须保持「类型 + 本文件局部代码」两种 import,禁止静态 import 任何
// src/server 或 src/engine 业务模块(如 app.ts):
//   vite.config.ts 由 esbuild 打包进 node_modules/.vite-temp/*.mjs 后执行,其静态
//   依赖树里的引擎代码同样被 esbuild 内联。引擎的技能模块动态加载(loaders.ts)
//   在该环境下分支一(vite-glob)不可用、分支二(Node 原生 import)无法解析无扩展名
//   的相对导入(如 '../core/apply')→ 所有对局在选将后技能实例化时抛
//   ERR_MODULE_NOT_FOUND(2026-08 回归)。
//   正确做法:REST/引擎代码经 server.ssrLoadModule 懒加载——与技能加载器同处
//   Vite SSR 模块世界,分支一生效,且 dev 热更新一致。
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

/** 从 SSR 世界取到的形状(app 默认导出 + 生命周期函数)。 */
interface ServerModule {
  default: { fetch: (req: Request) => Promise<Response> };
  startServerLifecycle(): void;
}

export function honoApiPlugin(): Plugin {
  let serverModule: ServerModule | null = null;
  let serverReady: Promise<ServerModule> | null = null;

  const loadServer = (server: ViteDevServer): Promise<ServerModule> => {
    if (serverModule) return Promise.resolve(serverModule);
    serverReady ??= server.ssrLoadModule('/src/server/app.ts').then((m) => {
      serverModule = m as unknown as ServerModule;
      // 启动服务器生命周期(闲置清理 + 持久化恢复)。
      // 仅 dev 模式(本插件 configureServer 只在 vite dev 调用)。
      serverModule.startServerLifecycle();
      return serverModule;
    });
    return serverReady;
  };

  return {
    name: 'hono-api',
    configureServer(server) {
      // 优雅关闭:vite dev 仅在 SIGTERM/stdin-end 时调 server.close(),
      // 而 Ctrl+C 发的是 SIGINT —— Node 默认直接终止进程,PGlite 来不及 close(),
      // 留下 postmaster.pid + 未刷 WAL,下次启动 crash recovery 时 WASM abort。
      const originalClose = server.close.bind(server);
      server.close = async () => {
        try {
          // SSR 世界里的清理函数
          const mods = await Promise.all([
            server.ssrLoadModule('/src/server/persistence.ts').catch(() => null),
            server.ssrLoadModule('/src/server/lifecycles.ts').catch(() => null),
            server.ssrLoadModule('/src/server/roomStore.ts').catch(() => null),
          ]);
          const [persistence, lifecycles, roomStore] = mods as Array<Record<string, (() => unknown) | null> | null>;
          await persistence?.flushPendingWrites?.();
          await lifecycles?.shutdownAll?.();
          await roomStore?.closeRoomStore?.();
        } catch {
          // 清理失败不阻塞关闭
        }
        return originalClose();
      };
      // Ctrl+C(SIGINT)vite 不处理:接管它,走完整关闭(含上面的清理)再退出。
      // 分级响应:第一次优雅关闭,第二次 SIGINT 立即强制退出;优雅关闭设 6s 超时
      // 兜底,防止清理卡住导致进程挂起(挂起后只能 kill -9 → PGlite 脏关闭 →
      // postmaster.pid 残留 → 恶性循环)。
      // 注意:主线程被同步死循环阻塞(如依赖优化卡死)时信号 callback 无法执行。
      let sigintCount = 0;
      process.on('SIGINT', () => {
        sigintCount++;
        if (sigintCount >= 2) {
          process.exit(130);
        }
        const forceExit = setTimeout(() => {
          process.exit(1);
        }, 6000);
        forceExit.unref();
        server
          .close()
          .catch(() => {})
          .finally(() => {
            clearTimeout(forceExit);
            process.exit(0);
          });
      });

      // 挂载 Hono REST API 到 /api(经 ssrLoadModule 与引擎同一模块世界)
      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const app = await loadServer(server);
          const fullPath = `/api${req.url ?? ''}`;
          const url = new URL(fullPath, `http://${req.headers.host}`);


          let body: string | undefined;
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            body = await new Promise<string>((resolve, reject) => {
              let data = '';
              req.on('data', (chunk: Buffer) => {
                data += chunk;
              });
              req.on('end', () => {
                resolve(data);
              });
              req.on('error', reject);
            });
          }

          const request = new Request(url.toString(), {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body,
          });

          const response = await app.default.fetch(request);
          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => {
            res.setHeader(key, value);
          });

          // SSE / streaming 响应：直接管道 body 流到 res，不缓冲
          const ct = response.headers.get('content-type') ?? '';
          if (ct.includes('text/event-stream') && response.body) {
            // flush headers 立即发送
            res.flushHeaders?.();
            const reader = response.body.getReader();
            const pump = async () => {
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(value);
                }
              } catch {
                // 客户端断开等
              } finally {
                res.end();
              }
            };
            // 客户端断开时取消 reader
            res.on('close', () => {
              reader.cancel().catch(() => {});
            });
            void pump();
            return; // 不走下面的 res.end
          }

          const responseBody = await response.text();
          res.end(responseBody);
        } catch (error) {
          console.error('[hono-api] API Error', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      });
    },
  };
}
