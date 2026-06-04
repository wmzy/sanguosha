// server/middleware/error-handler.ts — 全局错误处理中间件
import type { ErrorHandler } from 'hono';
import { createLogger } from '../logger';

const log = createLogger('error');

export const errorHandler: ErrorHandler = (err, c) => {
  log.error('Unhandled error', { method: c.req.method, path: c.req.path, error: String(err) });
  return c.json({ error: 'Internal Server Error' }, 500);
};
