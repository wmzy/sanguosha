// server/vite-plugin.ts
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import app from './app';
import { handleWsOpen, handleWsClose, handleWsMessage } from './app';
import { deserialize } from './protocol';
import { generatePlayerId } from './utils';
import { createLogger } from './logger';

const log = createLogger('vite-plugin');

export function honoApiPlugin(): Plugin {
  return {
    name: 'hono-api',
    configureServer(server) {
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

      // 返回 post-hook:在 Vite 内部 middleware 之后注册 WS upgrade handler
      // 避免 Vite HMR 拦截 /ws upgrade
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
              if (message) {
                handleWsMessage(playerId, message, {
                  send: (msg: string) => ws.send(msg),
                  close: () => ws.close(),
                } as never);
              }
            });

            ws.on('close', () => {
              handleWsClose(playerId);
              wsClients.delete(ws);
            });
          });
        });
      };
    },
  };
}
