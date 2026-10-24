// tests/server/middleware.test.ts
// tests/server/middleware.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { cors, requestLogger, rateLimit, errorHandler } from '../../src/server/middleware';
import { createRateLimit } from '../../src/server/middleware/rate-limit';

describe('CORS middleware', () => {
  it('should set Access-Control-Allow-Origin header on normal requests', async () => {
    const app = new Hono();
    app.use('*', cors);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request('http://localhost/test', {
        headers: { Origin: 'http://example.com' },
      }),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
    expect(res.status).toBe(200);
  });

  it('should handle OPTIONS preflight with 204', async () => {
    const app = new Hono();
    app.use('*', cors);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request('http://localhost/test', {
        method: 'OPTIONS',
        headers: { Origin: 'http://example.com' },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeTruthy();
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('should default to * when no Origin header', async () => {
    const app = new Hono();
    app.use('*', cors);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request('http://localhost/test'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('requestLogger middleware', () => {
  it('should pass through and set correct status', async () => {
    const app = new Hono();
    app.use('*', requestLogger);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request('http://localhost/test'));
    expect(res.status).toBe(200);
  });
});

describe('rateLimit middleware', () => {
  it('should allow requests under the limit', async () => {
    const app = new Hono();
    app.use('*', rateLimit);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request('http://localhost/test'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('6000');
    expect(res.headers.get('X-RateLimit-Remaining')).toBeTruthy();
  });

  it('should use the fixed peer instead of spoofable forwarding headers', async () => {
    const previous = process.env.SGS_TRUSTED_PROXIES;
    delete process.env.SGS_TRUSTED_PROXIES;
    try {
      const app = new Hono();
      const testLimit = createRateLimit(1);
      app.use('*', testLimit);
      app.get('/test', (c) => c.json({ ok: true }));
      const env = {
        incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1234 } },
      };

      const first = await app.fetch(
        new Request('http://localhost/test', { headers: { 'X-Forwarded-For': '198.51.100.1' } }),
        env,
      );
      const second = await app.fetch(
        new Request('http://localhost/test', { headers: { 'X-Forwarded-For': '198.51.100.2' } }),
        env,
      );
      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      const otherPeer = await app.fetch(new Request('http://localhost/test'), {
        incoming: { socket: { remoteAddress: '203.0.113.8', remotePort: 1235 } },
      });
      expect(otherPeer.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.SGS_TRUSTED_PROXIES;
      else process.env.SGS_TRUSTED_PROXIES = previous;
    }
  });

  it('should honor forwarding headers only when the peer is explicitly trusted', async () => {
    const previous = process.env.SGS_TRUSTED_PROXIES;
    process.env.SGS_TRUSTED_PROXIES = '10.0.0.1';
    try {
      const app = new Hono();
      const testLimit = createRateLimit(1);
      app.use('*', testLimit);
      app.get('/test', (c) => c.json({ ok: true }));
      const env = {
        incoming: { socket: { remoteAddress: '10.0.0.1', remotePort: 1234 } },
      };

      const first = await app.fetch(
        new Request('http://localhost/test', { headers: { 'X-Forwarded-For': '198.51.100.1' } }),
        env,
      );
      const secondClient = await app.fetch(
        new Request('http://localhost/test', { headers: { 'X-Forwarded-For': '198.51.100.2' } }),
        env,
      );
      const repeated = await app.fetch(
        new Request('http://localhost/test', { headers: { 'X-Forwarded-For': '198.51.100.1' } }),
        env,
      );
      expect(first.status).toBe(200);
      expect(secondClient.status).toBe(200);
      expect(repeated.status).toBe(429);
      const forgedPrefix = await app.fetch(new Request('http://localhost/test', {
        headers: { 'X-Forwarded-For': '192.0.2.99, 198.51.100.1' },
      }), { server: env });
      expect(forgedPrefix.status).toBe(429);
    } finally {
      if (previous === undefined) delete process.env.SGS_TRUSTED_PROXIES;
      else process.env.SGS_TRUSTED_PROXIES = previous;
    }
  });
});

describe('errorHandler middleware', () => {
  it('should catch unhandled errors and return 500', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/test', () => {
      throw new Error('test error');
    });

    const res = await app.fetch(new Request('http://localhost/test'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal Server Error');
  });
});
