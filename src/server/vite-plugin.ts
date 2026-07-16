// server/vite-plugin.ts
// Vite dev server 插件:把 Hono REST API 挂载到 Vite 的 HTTP server 上。
// 单端口模式:前端和后端共享 3930 端口。
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import app, { startServerLifecycle } from './app';
import { createLogger } from './logger';
import { flushPendingWrites } from './persistence';
import { shutdownAll } from './lifecycles';

const log = createLogger('vite-plugin');

export function honoApiPlugin(): Plugin {
  return {
    name: 'hono-api',
    configureServer(server) {
      // 启动服务器生命周期(闲置清理 + 持久化恢复)。
      // configureServer 仅在 vite dev 模式调用,vite build 不会触发。)
      startServerLifecycle();

      // 优雅关闭:vite dev 仅在 SIGTERM/stdin-end 时调 server.close(),
      // 而 Ctrl+C 发的是 SIGINT —— Node 默认直接终止进程,PGlite 来不及 close(),
      // 留下 postmaster.pid + 未刷 WAL,下次启动 crash recovery 时 WASM abort。
      const originalClose = server.close.bind(server);
      server.close = async () => {
        try {
          await flushPendingWrites();
          await shutdownAll();
        } catch (err) {
          log.error('关闭清理失败', { error: err });
        }
        return originalClose();
      };
      // Ctrl+C(SIGINT)vite 不处理:接管它,走完整关闭(含上面的清理)再退出。
      let sigintHandled = false;
      process.once('SIGINT', async () => {
        if (sigintHandled) return;
        sigintHandled = true;
        try {
          await server.close();
        } catch (err) {
          log.error('SIGINT 关闭失败', { error: err });
        }
        process.exit(0);
      });

      // 挂载 Hono REST API 到 /api
      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse) => {
        try {
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

          const response = await app.fetch(request);
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
          log.error('API Error', { error });
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      });
    },
  };
}
