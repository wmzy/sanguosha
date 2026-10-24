import { test, expect, request } from '@playwright/test';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import { DEFAULT_ROOM_CONFIG } from '../../src/server/protocol';

const baseURL = 'http://localhost:3930';

async function registerAccount(label: string) {
  const context = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const response = await context.post('/api/auth/register', {
    data: { username: `e2e-${label}-${crypto.randomUUID().slice(0, 8)}`, password: 'e2e-pass-123' },
  });
  expect(response.status()).toBe(200);
  const account = await response.json() as { token: string; user: { id: string } };
  return { context, ...account };
}

test('Bearer 无头客户端完成普通房间准备、配置、聊天、开局和选将', async () => {
  test.setTimeout(60_000);
  const hostAccount = await registerAccount('host');
  const guestAccount = await registerAccount('guest');
  const errors: string[] = [];
  const chat: string[] = [];
  const host = new HeadlessGameClient(baseURL, {
    onError: (error) => errors.push(error.message),
  }, { token: hostAccount.token });
  const guest = new HeadlessGameClient(baseURL, {
    onError: (error) => errors.push(error.message),
    onChat: (messages) => chat.push(...messages.map((message) => message.text)),
  }, { token: guestAccount.token });
  let roomId: string | null = null;
  try {
    await host.createRoom('认证契约', 2, { ...DEFAULT_ROOM_CONFIG, timeoutSec: 0, charPool: 'standard' });
    roomId = host.roomId;
    expect(roomId).toBeTruthy();
    await guest.joinRoom(roomId!);
    await expect.poll(() => host.roomState?.playerIds.length).toBe(2);
    await expect.poll(() => guest.roomState?.playerIds.length).toBe(2);
    await host.sendUpdateConfig({ ...DEFAULT_ROOM_CONFIG, name: '认证房间', timeoutSec: 0, charPool: 'standard' });
    await expect.poll(() => guest.roomState?.config.name).toBe('认证房间');
    await host.sendReady();
    await guest.sendReady();
    await expect.poll(() => host.roomState?.readyPlayers.slice().sort()).toEqual(
      [hostAccount.user.id, guestAccount.user.id].sort(),
    );
    await host.sendStartGame();
    const clients = [host, guest];
    for (let selection = 0; selection < clients.length; selection++) {
      await expect.poll(() => clients.some((client) =>
        client.getAvailableActions().some((action) => action.category === 'selectChar'),
      ), { timeout: 15_000 }).toBe(true);
      const client = clients.find((candidate) =>
        candidate.getAvailableActions().some((action) => action.category === 'selectChar'),
      )!;
      const action = client.getAvailableActions().find((candidate) => candidate.category === 'selectChar')!;
      client.sendAction(action.message);
      await expect.poll(() => Boolean(client.view?.players[client.seatIndex]?.character)).toBe(true);
    }
    await expect.poll(() => host.view?.players.every((player) => !!player.character)).toBe(true);
    await host.sendChat('认证聊天');
    await expect.poll(() => chat).toContain('认证聊天');
    await host.sendRestart();
    await expect.poll(() => host.roomState?.readyPlayers).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    host.disconnect();
    guest.disconnect();
    if (roomId) await hostAccount.context.delete(`/api/rooms/${roomId}`);
    await hostAccount.context.dispose();
    await guestAccount.context.dispose();
  }
});

test('旁观者加入普通房间后能切换玩家并准备', async ({ browser }) => {
  const host = await registerAccount('ui-host');
  const spectator = await registerAccount('ui-spec');
  const created = await host.context.post('/api/rooms', { data: { name: '身份切换', maxPlayers: 2 } });
  expect(created.status()).toBe(200);
  const { roomId } = await created.json() as { roomId: string };
  const context = await browser.newContext({ baseURL, storageState: await spectator.context.storageState() });
  try {
    const page = await context.newPage();
    await page.goto('/play');
    await page.getByPlaceholder('输入6位房间码').last().fill(roomId);
    await page.getByRole('button', { name: '旁观加入' }).click();
    await expect(page.getByRole('button', { name: '准备', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '旁观中（加入游戏）' }).click();
    await page.getByRole('button', { name: '准备', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
  } finally {
    await context.close();
    await host.context.delete(`/api/rooms/${roomId}`);
    await host.context.dispose();
    await spectator.context.dispose();
  }
});


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
    const { context: ctx } = await registerAccount('delete');
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
    // 移除游客模式后,创建普通房间必须登录(REST 支持 Authorization: Bearer;
    // SSE EventSource 无法带自定义头,走 ?sgs_token= 查询参数通道)
    const regRes = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `e2erv${Date.now().toString(36)}`, password: 'e2e-pass-123' }),
    });
    expect(regRes.status).toBe(200);
    const reg = (await regRes.json()) as { token: string; user: { id: string } };
    const token = reg.token;
    const spectatorId = reg.user.id; // 服务端强制旁观者 id = 登录 userId
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });

    const created = await post('/api/rooms', { maxPlayers: 2, roomType: 'quick' });
    expect(created.status).toBe(200);
    const { roomId, playerId: host } = (await created.json()) as { roomId: string; playerId: string };

    // 连接 host SSE 流(读取 room_state 广播)
    const sse = await fetch(`${base}/api/rooms/${roomId}/stream?playerId=${host}&sgs_token=${token}`);
    const reader = sse.body!.getReader();
    try {
      // 旁观注册 + 申请查看座次 0(spectatorId 必须等于登录 userId——
      // join-spectator 服务端强制写入 user.id,request-view 校验其为在册旁观者)
      expect((await post(`/api/rooms/${roomId}/join-spectator`, {})).status).toBe(200);
      const res = (await (
        await post(`/api/rooms/${roomId}/request-view`, { spectatorId, targetSeat: 0 })
      ).json()) as { success?: boolean };
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
        if (buf.includes('pendingViewRequests') && buf.includes(`"${spectatorId}":0`)) { found = true; break; }
      }
      expect(found).toBe(true);
    } finally {
      await reader.cancel();
    }
  });
});
