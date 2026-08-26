// tests/server/sse-auth.test.ts — GET /api/rooms/:id/stream 成员资格校验回归。
// 来源:2026-08-26 修复 src/server/sse.ts——非 debug 房此前不校验成员资格,任何登录
// 用户凭 roomId 直连 stream 可绕过 POST /join 的密码/容量/状态三重校验入房,且玩家
// 分支的 ensureSeatOnReconnect 会把非成员补进空座(重启恢复路径的副作用被滥用为越权
// 入口)。归并建议:后续 SSE REST 层用例继续追加到本文件。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { applyRestRoutes } from '../../src/server/rest';
import { applyAuthRoutes } from '../../src/server/auth/routes';
import { initRoomStore, closeRoomStore } from '../../src/server/roomStore';
import { _resetForTests as resetLifecycles } from '../../src/server/lifecycles';
import { gameSessions, playerRoomMap } from '../../src/server/registry';
import { createRoom, getRoom, deleteRoom } from '../../src/server/room';
import type { ConnectionSink } from '../../src/server/connection';

function createCaptureSink(captured: unknown[]): ConnectionSink {
  return {
    send: (msg) => captured.push(msg),
    close: () => {},
    isAlive: true,
  };
}

async function register(
  app: Hono,
  username: string,
): Promise<{ cookie: string; userId: string }> {
  const reg = await app.fetch(
    new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'pass123' }),
    }),
  );
  expect(reg.status).toBe(200);
  return {
    cookie: reg.headers.get('set-cookie')!.split(';')[0],
    userId: ((await reg.json()) as { user: { id: string } }).user.id,
  };
}

describe('GET /api/rooms/:id/stream 成员资格校验(非 debug 房)', () => {
  let app: Hono;

  beforeAll(async () => {
    await initRoomStore(':memory:');
  });
  afterAll(async () => {
    await closeRoomStore();
    resetLifecycles();
  });

  beforeEach(() => {
    gameSessions.clear();
    playerRoomMap.clear();
    app = new Hono();
    applyAuthRoutes(app);
    applyRestRoutes(app);
  });

  it('非成员登录用户直连 stream 被 403 且不被补座;成员可建流', async () => {
    const host = await register(app, `sh-${Date.now()}`);
    const stranger = await register(app, `ss-${Date.now()}`);
    // createRoom:seats[0]=hostId,host 在成员名单内;stranger 与房间无任何关联
    const room = createRoom('测试', 2, host.userId, createCaptureSink([]));
    try {
      const url = `http://localhost/api/rooms/${room.id}/stream`;

      // 非成员直连 → 403(修复前:200 且 ensureSeatOnReconnect 把 stranger 补进空座)
      const res = await app.fetch(new Request(url, { headers: { Cookie: stranger.cookie } }));
      expect(res.status).toBe(403);
      await res.body?.cancel();

      // 未被补座:seats 保持只有 host
      const after = getRoom(room.id)!;
      expect(after.seats).toEqual([host.userId, null]);
      expect(after.players.has(stranger.userId)).toBe(false);

      // 成员(host)→ SSE 流建立(streamSSE 返回 streaming Response)
      const ok = await app.fetch(new Request(url, { headers: { Cookie: host.cookie } }));
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toContain('text/event-stream');
      await ok.body?.cancel();
    } finally {
      deleteRoom(room.id);
    }
  });

  it('未登录者访问非 debug 房 stream 仍为 401(登录门禁保持)', async () => {
    const host = await register(app, `sh2-${Date.now()}`);
    const room = createRoom('测试', 2, host.userId, createCaptureSink([]));
    try {
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.id}/stream`),
      );
      expect(res.status).toBe(401);
    } finally {
      deleteRoom(room.id);
    }
  });
});
