// server/index.ts — 独立运行模式（与 Vite 共享端口时不需要此文件）
import { serve } from '@hono/node-server';
import app, { startServerLifecycle } from './app';
import { createLogger } from './logger';
import { setupGracefulShutdown } from './lifecycle';

const log = createLogger('server');

const port = parseInt(process.env.PORT ?? '3930');
const host = process.env.HOST ?? '0.0.0.0';
const server = serve({ fetch: app.fetch, port, hostname: host });
setupGracefulShutdown(server);
startServerLifecycle();

log.info(`服务器运行在 http://${host}:${port}`);
