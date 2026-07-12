// server/vite-plugin.ts
// Vite dev server 插件:把 Hono REST API 挂载到 Vite 的 HTTP server 上。
// 单端口模式:前端和后端共享 3930 端口。
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import app, { startServerLifecycle } from './app';
import { createLogger } from './logger';

const log = createLogger('vite-plugin');

export function honoApiPlugin(): Plugin {
  return {
    name: 'hono-api',
    configureServer(server) {
      // 启动服务器生命周期(闲置清理 + 持久化恢复)。
      // configureServer 仅在 vite dev 模式调用,vite build 不会触发。)
      startServerLifecycle();

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
