// server/middleware/rate-limit.ts — 内存版速率限制中间件
import type { MiddlewareHandler } from 'hono';

const windowMs = 60_000;
const clients = new Map<string, { count: number; resetAt: number }>();

function cleanup(): void {
  const now = Date.now();
  for (const [key, entry] of clients) {
    if (now > entry.resetAt) {
      clients.delete(key);
    }
  }
}

// 每 5 分钟清理过期条目
const cleanupInterval = setInterval(cleanup, 5 * 60_000);
cleanupInterval.unref();

/** 重置速率限制状态（测试用） */
export function _resetRateLimitState(): void {
  clients.clear();
}

export function createRateLimit(maxRequests = 6000): MiddlewareHandler {
  return async (c, next) => {
    const ip =
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
      c.req.header('X-Real-IP') ??
      'unknown';

    const now = Date.now();
    let entry = clients.get(ip);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      clients.set(ip, entry);
    }

    entry.count++;

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));

    if (entry.count > maxRequests) {
      return c.json({ error: '请求过于频繁，请稍后再试' }, 429);
    }

    await next();
  };
}

/** 默认速率限制：6000 req/min（支持 4 个 AI agent 并发） */
export const rateLimit = createRateLimit(6000);
