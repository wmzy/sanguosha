// tests/server/middleware.test.ts
// tests/server/middleware.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { cors, requestLogger, rateLimit, errorHandler } from '../../src/server/middleware';

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
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(res.headers.get('X-RateLimit-Remaining')).toBeTruthy();
  });

  it('should block requests exceeding the limit', async () => {
    const app = new Hono();
    app.use('*', rateLimit);
    app.get('/test', (c) => c.json({ ok: true }));

    const results = [];
    for (let i = 0; i < 65; i++) {
      const res = await app.fetch(
        new Request('http://localhost/test', {
          headers: { 'X-Forwarded-For': '1.2.3.4' },
        }),
      );
      results.push(res.status);
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
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
