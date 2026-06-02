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
});
