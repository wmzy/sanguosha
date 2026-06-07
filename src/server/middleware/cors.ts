// server/middleware/cors.ts — CORS 中间件
import type { MiddlewareHandler } from 'hono';

export const cors: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('Origin') ?? '*';

  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    c.header('Access-Control-Max-Age', '86400');
    return c.body(null, 204);
  }

  await next();

  c.header('Access-Control-Allow-Origin', origin);
};
