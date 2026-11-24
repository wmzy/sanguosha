// server/index.ts — 独立运行模式(与 Vite 共享端口时不需要此文件)
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import { app, startServerLifecycle } from './app';
import { createLogger } from './logger';
import { installProcessErrorHandlers, setupGracefulShutdown } from './shutdown';

const log = createLogger('server');

const port = parseInt(process.env.PORT ?? '3930');
const host = process.env.HOST ?? '0.0.0.0';
/** 构建产物目录:按模块位置解析(而非 cwd),从任意目录启动都能托管 dist/。 */
const distRoot = fileURLToPath(new URL('../../dist', import.meta.url));
const distIndex = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
await startServerLifecycle();

/** 生产组合根:API(app) + dist/ 静态资源 + SPA fallback。
 *  Vite dev 模式下由 Vite 自己托管前端,不走这里;`vite preview` 只有静态没有 API。
 *  故独立部署一律 `pnpm build && pnpm server`。 */
const productionApp = new Hono();
productionApp.use('*', serveStatic({ root: distRoot }));
productionApp.route('/', app);
// SPA history fallback:非 /api 的 GET 未命中文件 → index.html
productionApp.get('*', serveStatic({ path: distIndex }));

const server = serve({ fetch: productionApp.fetch, port, hostname: host });
installProcessErrorHandlers();
setupGracefulShutdown(server);

log.info(`服务器运行在 http://${host}:${port}(静态资源 ${distRoot})`);
