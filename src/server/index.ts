// server/index.ts — 独立运行模式（与 Vite 共享端口时不需要此文件）
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import app, { handleWsOpen, handleWsClose, handleWsMessage, startServerLifecycle } from './app';
import { deserialize, serialize } from './protocol';
import { generatePlayerId } from './utils';
import { findRoomByPlayerId } from './room';
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

        // set_player_id: 连接初期声明期望 playerId(供 AI/客户端指定稳定标识)。
        // 直接更新闭包变量,后续 create_room/join_room 等都用新 id。
        // 仅在未加入房间时允许(避免游戏中篡改身份)。
        if (message.type === 'set_player_id') {
          const newId = message.playerId.trim();
          if (newId && !findRoomByPlayerId(currentPlayerId)) {
            currentPlayerId = newId;
          }
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
startServerLifecycle();

log.info(`服务器运行在 http://${host}:${port}`);
log.info(`WebSocket端点: ws://${host}:${port}/ws`);
