import { test, expect, request } from '@playwright/test';

test.describe('多人房间 API', () => {
  test('GET /api/rooms 返回空数组', async () => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:3930' });
    const res = await ctx.get('/api/rooms');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    await ctx.dispose();
  });

  test('POST /api/debug-room 创建调试房间并返回 roomId', async () => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:3930' });
    const res = await ctx.post('/api/debug-room', { data: { playerCount: 4 } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('roomId');
    expect(typeof body.roomId).toBe('string');
    expect(body.roomId.length).toBe(6);
    await ctx.dispose();
  });

  test('POST /api/debug-room 校验 playerCount 范围', async () => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:3930' });
    const tooSmall = await ctx.post('/api/debug-room', { data: { playerCount: 1 } });
    expect(tooSmall.status()).toBe(400);
    const tooBig = await ctx.post('/api/debug-room', { data: { playerCount: 9 } });
    expect(tooBig.status()).toBe(400);
    await ctx.dispose();
  });

  test('GET /api/rooms/:id 查询已存在的调试房间', async () => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:3930' });
    const create = await ctx.post('/api/debug-room', { data: { playerCount: 3 } });
    const { roomId } = await create.json();
    const get = await ctx.get(`/api/rooms/${roomId}`);
    expect(get.status()).toBe(200);
    const body = await get.json();
    expect(body.id).toBe(roomId);
    expect(body.status).toBe('等待中');
    await ctx.dispose();
  });

  test('GET /api/rooms/:id 404 当房间不存在', async () => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:3930' });
    const res = await ctx.get('/api/rooms/ZZZZZZ');
    expect(res.status()).toBe(404);
    await ctx.dispose();
  });

  test('DELETE /api/rooms/:id 删除调试房间', async () => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:3930' });
    const create = await ctx.post('/api/debug-room', { data: { playerCount: 3 } });
    const { roomId } = await create.json();
    const del = await ctx.delete(`/api/rooms/${roomId}`);
    expect(del.status()).toBe(200);
    const get = await ctx.get(`/api/rooms/${roomId}`);
    expect(get.status()).toBe(404);
    await ctx.dispose();
  });

  test('DELETE /api/rooms/:id 删除普通多人房间', async () => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:3930' });
    const create = await ctx.post('/api/rooms', { data: { name: 'test-delete', maxPlayers: 2 } });
    expect(create.status()).toBe(200);
    const { roomId } = await create.json();
    const del = await ctx.delete(`/api/rooms/${roomId}`);
    expect(del.status()).toBe(200);
    const get = await ctx.get(`/api/rooms/${roomId}`);
    expect(get.status()).toBe(404);
    await ctx.dispose();
  });

  test('POST /api/rooms/:id/request-view 广播含 pendingViewRequests 的 room_state', async () => {
    const base = 'http://localhost:3930';
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const { roomId, playerId: host } = await (await post('/api/rooms', { maxPlayers: 2, roomType: 'quick' })).json() as { roomId: string; playerId: string };

    // 连接 host SSE 流(读取 room_state 广播)
    const sse = await fetch(`${base}/api/rooms/${roomId}/stream?playerId=${host}`);
    const reader = sse.body!.getReader();
    try {
      // 旁观注册 + 申请查看座次 0
      await post(`/api/rooms/${roomId}/join-spectator`, { playerId: 'specReqView' });
      const res = await (await post(`/api/rooms/${roomId}/request-view`, { spectatorId: 'specReqView', targetSeat: 0 })).json() as { success: boolean };
      expect(res.success).toBe(true);

      // 读取 SSE 流,确认收到含 pendingViewRequests 的 room_state
      // (回归: request-view 曾遗漏 broadcastRoomState,导致客户端 pendingViewRequests 永不更新)
      const deadline = Date.now() + 8000;
      let buf = '';
      let found = false;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value, { stream: true });
        if (buf.includes('pendingViewRequests') && buf.includes('"specReqView":0')) { found = true; break; }
      }
      expect(found).toBe(true);
    } finally {
      await reader.cancel();
    }
  });
});
