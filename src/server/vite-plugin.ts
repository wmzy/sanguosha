// server/vite-plugin.ts
// Vite dev server 插件:把 Hono REST API + WebSocket 挂载到 Vite 的 HTTP server 上。
// 单端口模式:前端和后端共享 3930 端口。
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import app, { handleWsOpen, handleWsClose, handleWsMessage, startServerLifecycle } from './app';
import { deserialize } from './protocol';
import { generatePlayerId } from './utils';
import { findRoomByPlayerId } from './room';
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
          const responseBody = await response.text();
          res.end(responseBody);
        } catch (error) {
          log.error('API Error', { error });
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      });

      // 返回 post-hook:在 Vite 内部 middleware 之后注册 WS upgrade handler。
      // 避免 Vite HMR 拦截 /ws upgrade。
      return () => {
        const wss = new WebSocketServer({ noServer: true });
        const wsClients = new Map<WebSocket, string>();

        server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
          const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
          if (url.pathname !== '/ws') return;

          wss.handleUpgrade(req, socket, head, (ws) => {
            const playerId = generatePlayerId();
            wsClients.set(ws, playerId);
            handleWsOpen(playerId);

            ws.on('message', (data: Buffer) => {
              const message = deserialize(data.toString());
              if (!message) return;
              const currentId = wsClients.get(ws) ?? playerId;
              // set_player_id: 连接初期声明期望 playerId(供 AI/客户端指定稳定标识)。
              // 仅在未加入房间时允许(避免游戏中篡改身份)。与 src/server/index.ts 保持一致。
              if (message.type === 'set_player_id') {
                const newId = message.playerId.trim();
                if (newId && !findRoomByPlayerId(currentId)) {
                  wsClients.set(ws, newId);
                }
                return;
              }
              handleWsMessage(currentId, message, {
                send: (msg: string) => ws.send(msg),
                close: () => ws.close(),
              } as never);
            });

            ws.on('close', () => {
              const finalId = wsClients.get(ws) ?? playerId;
              handleWsClose(finalId);
              wsClients.delete(ws);
            });
          });
        });
      };
    },
  };
}
