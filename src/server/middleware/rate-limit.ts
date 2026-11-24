// server/middleware/rate-limit.ts — 内存版速率限制中间件
import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { BlockList, isIP } from 'node:net';

const windowMs = 60_000;

function normalizeAddress(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const address = raw.trim();
  // Node 双栈监听器可能把 IPv4 peer 表示为 ::ffff:a.b.c.d。
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const normalized = mapped?.[1] ?? address;
  return isIP(normalized) ? normalized : undefined;
}

/** SGS_TRUSTED_PROXIES:逗号分隔的代理 IP 白名单;缺省不信任任何代理头。
 *  按环境变量值缓存(测试会改 env)。无法解析的条目静默忽略,但会打一次警告,
 *  避免运维以为已生效。 */
let trustedCache: { raw: string; list: BlockList } | null = null;

function trustedProxies(): BlockList {
  const raw = process.env.SGS_TRUSTED_PROXIES ?? '';
  if (trustedCache?.raw === raw) return trustedCache.list;
  const trusted = new BlockList();
  for (const entry of raw.split(',')) {
    if (!entry.trim()) continue;
    const address = normalizeAddress(entry);
    if (address) {
      trusted.addAddress(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
    } else {
      // 只在值变化时提示一次(缓存在下一行更新,不会重复)
      console.warn(`[rate-limit] 忽略无法解析的 SGS_TRUSTED_PROXIES 条目: ${JSON.stringify(entry)}`);
    }
  }
  trustedCache = { raw, list: trusted };
  return trusted;
}

function isTrustedAddress(address: string, trusted: BlockList): boolean {
  return trusted.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
}

/** 连接对端地址。无 socket(单元测试的 app.request / 非 HTTP 适配层)返回 undefined。 */
export function peerAddress(c: Context): string | undefined {
  const bindings = c.env?.server ?? c.env;
  return bindings?.incoming?.socket ? normalizeAddress(getConnInfo(c).remote.address) : undefined;
}

/** 对端是否可信代理(socket 不存在时一律不可信)。 */
export function isTrustedPeer(c: Context): boolean {
  const peer = peerAddress(c);
  return !!peer && isTrustedAddress(peer, trustedProxies());
}

/** 可信代理转发的原始 scheme(X-Forwarded-Proto 首个值);不可信 peer 一律返回 undefined。 */
export function trustedForwardedProto(c: Context): string | undefined {
  if (!isTrustedPeer(c)) return undefined;
  const raw = c.req.header('X-Forwarded-Proto');
  return raw?.split(',')[0]?.trim().toLowerCase();
}

function clientKey(c: Context): string {
  const peer = peerAddress(c);
  if (!peer) return 'direct';
  const trusted = trustedProxies();
  if (!isTrustedAddress(peer, trusted)) return peer;

  const forwarded = c.req.header('X-Forwarded-For');
  if (forwarded !== undefined) {
    // 代理应追加真实来源;从右往左越过可信代理,在首个不可信节点停止。
    // 不能读最左地址,否则客户端在可信代理追加前伪造的前缀仍能逃逸。
    const chain = forwarded.split(',');
    let address = peer;
    for (let i = chain.length - 1; i >= 0 && isTrustedAddress(address, trusted); i--) {
      const previous = normalizeAddress(chain[i]);
      if (!previous) return peer;
      address = previous;
    }
    return address;
  }
  // 仅可信 peer 可使用 X-Real-IP,代理必须覆盖而非透传该头。
  return normalizeAddress(c.req.header('X-Real-IP')) ?? peer;
}

function cleanup(clients: Map<string, { count: number; resetAt: number }>): void {
  const now = Date.now();
  for (const [key, entry] of clients) {
    if (now > entry.resetAt) clients.delete(key);
  }
}

export function createRateLimit(maxRequests = 6000): MiddlewareHandler {
  // 每个 limiter 独立计数,避免全局高频只读端点消耗登录/注册的严格配额。
  const clients = new Map<string, { count: number; resetAt: number }>();
  const cleanupInterval = setInterval(() => cleanup(clients), 5 * 60_000);
  cleanupInterval.unref();

  return async (c, next) => {
    const ip = clientKey(c);
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
