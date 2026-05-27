// server/index.ts — 独立运行模式（与 Vite 共享端口时不需要此文件）
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import app, { handleWsOpen, handleWsClose, handleWsMessage } from './app';
import { deserialize, serialize } from './协议';
import { generatePlayerId } from './utils';

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// 玩家ID生成
function 生成玩家ID(): string {
  return generatePlayerId();
}

// WebSocket端点
app.get(
  '/ws',
  upgradeWebSocket(() => {
    let 当前玩家ID: string | null = null;

    return {
      onOpen() {
        当前玩家ID = 生成玩家ID();
        handleWsOpen(当前玩家ID);
      },

      onMessage(event, ws) {
        if (typeof event.data !== 'string') return;

        const message = deserialize(event.data);
        if (!message) {
          ws.send(serialize({ type: 'error', message: '无效的消息格式' }));
          return;
        }

        if (!当前玩家ID) {
          ws.send(serialize({ type: 'error', message: '未初始化' }));
          return;
        }

        handleWsMessage(当前玩家ID, message, ws);
      },

      onClose() {
        if (当前玩家ID) {
          handleWsClose(当前玩家ID);
        }
      },
    };
  }),
);

const port = parseInt(process.env.PORT ?? '3001');
const server = serve({ fetch: app.fetch, port });
injectWebSocket(server);

console.warn(`服务器运行在 http://localhost:${port}`);
console.warn(`WebSocket端点: ws://localhost:${port}/ws`);
