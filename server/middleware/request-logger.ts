// server/middleware/request-logger.ts — 请求日志中间件
import type { MiddlewareHandler } from 'hono';
import { createLogger } from '../logger';

const log = createLogger('http');

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  log.info(`${method} ${path} → ${status} (${duration}ms)`);
};
