// server/index.ts — 独立运行模式（与 Vite 共享端口时不需要此文件）
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import app, { handleWsOpen, handleWsClose, handleWsMessage } from './app';
import { deserialize, serialize } from './protocol';
import { generatePlayerId } from './utils';
import { createLogger } from './logger';
import { setupGracefulShutdown } from './lifecycle';

const log = createLogger('server');

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// WebSocket端点
app.get(
  '/ws',
  upgradeWebSocket(() => {
    let currentPlayerId: string | null = null;

    return {
      onOpen() {
        currentPlayerId = generatePlayerId();
        handleWsOpen(currentPlayerId);
      },

      onMessage(event, ws) {
        if (typeof event.data !== 'string') return;

        const message = deserialize(event.data);
        if (!message) {
          ws.send(serialize({ type: 'error', message: '无效的消息格式' }));
          return;
        }

        if (!currentPlayerId) {
          ws.send(serialize({ type: 'error', message: '未初始化' }));
          return;
        }

        handleWsMessage(currentPlayerId, message, ws);
      },

      onClose() {
        if (currentPlayerId) {
          handleWsClose(currentPlayerId);
        }
      },
    };
  }),
);

const port = parseInt(process.env.PORT ?? '3930');
const host = process.env.HOST ?? '0.0.0.0';
const server = serve({ fetch: app.fetch, port, hostname: host });
injectWebSocket(server);
setupGracefulShutdown(server);

log.info(`服务器运行在 http://${host}:${port}`);
log.info(`WebSocket端点: ws://${host}:${port}/ws`);
