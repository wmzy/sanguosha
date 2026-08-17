// tests/server/auth.test.ts — 用户认证模块测试(注册/登录/会话/GitHub upsert)
// 与房间密码端点测试(建房带密码/加房验证/旁观验证/改密)。
// 来源:2026-08-17 用户登录认证 + 房间密码需求;后续相关回归用例归并到此文件。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { applyAuthRoutes } from '../../src/server/auth/routes';
import { applyRestRoutes } from '../../src/server/rest';
import {
  initRoomStore,
  closeRoomStore,
  loadAllRoomsFromDb,
} from '../../src/server/roomStore';
import { getRoom } from '../../src/server/room';
import { hashPassword, verifyPassword } from '../../src/server/auth/password';
import { upsertGithubUser, getUserByToken, createSession, createUser, verifyLogin, deleteSession } from '../../src/server/auth/store';
import { _resetRateLimitState } from '../../src/server/middleware/rate-limit';
import { _resetForTests as resetLifecycles } from '../../src/server/lifecycles';

function makeApp(): Hono {
  const app = new Hono();
  applyAuthRoutes(app);
  applyRestRoutes(app);
  return app;
}

beforeAll(async () => {
  // 内存数据库(不传 dataDir = :memory:),隔离且随进程丢弃
  await initRoomStore(':memory:');
});

afterAll(async () => {
  await closeRoomStore();
  resetLifecycles();
  _resetRateLimitState();
});

// ── 密码纯函数 ──

describe('auth/password', () => {
  it('hash → verify 往返', async () => {
    const h = await hashPassword('secret123');
    expect(h).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPassword('secret123', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });

  it('同密码两次哈希盐不同(结果不同)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('verify 对 null/畸形存储返回 false 不抛', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'no-colon')).toBe(false);
    expect(await verifyPassword('x', 'zz:zz')).toBe(false);
  });
});

// ── 用户存储 ──

describe('auth/store', () => {
  it('注册 → 登录 → 会话往返', async () => {
    const created = await createUser('张飞_ZF', 'pass123');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.user.username).toBe('张飞_zf'); // 小写规范化
    expect(created.user.hasPassword).toBe(true);

    const bad = await verifyLogin('张飞_ZF', 'wrong');
    expect(bad.ok).toBe(false);
    const ok = await verifyLogin('张飞_zf', 'pass123');
    expect(ok.ok).toBe(true);

    const session = await createSession(created.user.id);
    expect(session).not.toBeNull();
    const byToken = await getUserByToken(session!.token);
    expect(byToken?.username).toBe('张飞_zf');
    await deleteSession(session!.token);
    expect(await getUserByToken(session!.token)).toBeNull();
  });

  it('重复用户名拒绝', async () => {
    await createUser('dupuser', 'pass123');
    const dup = await createUser('DUPUSER', 'other456');
    expect(dup.ok === false && dup.error === '用户名已存在').toBe(true);
  });

  it('非法用户名/密码拒绝', async () => {
    expect((await createUser('a', 'pass123')).ok).toBe(false);
    expect((await createUser('okname', '12345')).ok).toBe(false);
  });

  it('不存在的用户登录失败但不抛', async () => {
    const r = await verifyLogin('ghost_user', 'whatever');
    expect(r.ok).toBe(false);
  });

  it('GitHub upsert:首次创建,二次复用并刷新资料', async () => {
    const first = await upsertGithubUser({
      githubId: '10001',
      username: 'octocat',
      displayName: 'Octo Cat',
      avatarUrl: 'https://avatars.example.com/octo.png',
    });
    expect(first.ok && first.created).toBe(true);
    const second = await upsertGithubUser({
      githubId: '10001',
      username: 'octocat',
      displayName: 'Octo Renamed',
      avatarUrl: null,
    });
    expect(second.ok && !second.created).toBe(true);
    if (second.ok) {
      expect(second.user.displayName).toBe('Octo Renamed');
      expect(second.user.githubLinked).toBe(true);
      expect(second.user.hasPassword).toBe(false);
    }
  });

  it('GitHub username 冲突时追加后缀', async () => {
    await createUser('taken_name', 'pass123');
    const r = await upsertGithubUser({
      githubId: '10002',
      username: 'taken.name', // normalize 后 taken_name
      displayName: 'T',
      avatarUrl: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.username).not.toBe('taken_name');
  });
});

// ── HTTP 路由 ──

describe('auth/routes', () => {
  it('注册返回 Set-Cookie 且 /me 恢复登录态', async () => {
    const app = makeApp();
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'route_user', password: 'pass123' }),
    });
    expect(reg.status).toBe(200);
    const cookie = reg.headers.get('set-cookie');
    expect(cookie).toContain('sgs_session=');
    expect(cookie).toContain('HttpOnly');

    const me = await app.request('/api/auth/me', {
      headers: { Cookie: cookie!.split(';')[0] },
    });
    const meBody = (await me.json()) as { user: { username: string } | null };
    expect(meBody.user?.username).toBe('route_user');
  });

  it('错误密码 401,正确密码 200', async () => {
    const app = makeApp();
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pw_user', password: 'right123' }),
    });
    const bad = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pw_user', password: 'wrong123' }),
    });
    expect(bad.status).toBe(401);
    const good = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'PW_USER', password: 'right123' }),
    });
    expect(good.status).toBe(200);
  });

  it('登出后 /me 无用户', async () => {
    const app = makeApp();
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'logout_user', password: 'pass123' }),
    });
    const cookie = reg.headers.get('set-cookie')!.split(';')[0];
    await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
    const body = (await me.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });

  it('GitHub 未配置时入口 503', async () => {
    const app = makeApp();
    const prevId = process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_ID;
    const res = await app.request('/api/auth/github');
    expect(res.status).toBe(503);
    if (prevId) process.env.GITHUB_CLIENT_ID = prevId;
  });
});

// ── 房间密码端点 ──

describe('房间密码', () => {
  it('建房带密码 → 列表投影 hasPassword,哈希不出现在响应', async () => {
    const app = makeApp();
    const created = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '密码房', maxPlayers: 4, playerId: 'pw-host', password: '1234' }),
    });
    expect(created.status).toBe(200);
    const { roomId } = (await created.json()) as { roomId: string };

    const list = (await (
      await app.request('/api/rooms?type=multiplayer')
    ).json()) as Array<{ id: string; hasPassword?: boolean }>;
    const item = list.find((r) => r.id === roomId);
    expect(item?.hasPassword).toBe(true);
    // 哈希绝不出现在任何投影
    const raw = JSON.stringify(list);
    expect(raw).not.toMatch(/passwordHash/i);

    const room = getRoom(roomId);
    expect(room?.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it('无密码直接加入;有密码缺失/错误 403,正确放行', async () => {
    const app = makeApp();

    // 无密码房
    const free = await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '自由房', maxPlayers: 4, playerId: 'free-host' }),
      })
    ).json() as { roomId: string };
    const joinFree = await app.request(`/api/rooms/${free.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest1' }),
    });
    expect(joinFree.status).toBe(200);

    // 有密码房
    const locked = await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '锁房', maxPlayers: 4, playerId: 'lock-host', password: '九个密码9' }),
      })
    ).json() as { roomId: string };

    const noPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest2' }),
    });
    expect(noPw.status).toBe(403);
    expect(((await noPw.json()) as { code?: string }).code).toBe('ROOM_PASSWORD_REQUIRED');

    const wrongPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest2', password: 'wrong' }),
    });
    expect(wrongPw.status).toBe(403);

    const okPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest2', password: '九个密码9' }),
    });
    expect(okPw.status).toBe(200);

    // 成员重连免密
    const rejoin = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest2' }),
    });
    expect(rejoin.status).toBe(200);
  });

  it('旁观同样需要密码,已入房旁观者免密', async () => {
    const app = makeApp();
    const locked = await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '旁观锁房', maxPlayers: 4, playerId: 'sp-host', password: 'sp1234' }),
      })
    ).json() as { roomId: string };

    const noPw = await app.request(`/api/rooms/${locked.roomId}/join-spectator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'spec1' }),
    });
    expect(noPw.status).toBe(403);

    const okPw = await app.request(`/api/rooms/${locked.roomId}/join-spectator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'spec1', password: 'sp1234' }),
    });
    expect(okPw.status).toBe(200);

    // 已在 spectators 中(重连)免密
    const rejoin = await app.request(`/api/rooms/${locked.roomId}/join-spectator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'spec1' }),
    });
    expect(rejoin.status).toBe(200);
  });

  it('房主可改密/清除密码,非房主 403', async () => {
    const app = makeApp();
    const locked = await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '改密房', maxPlayers: 4, playerId: 'mod-host', password: 'old123' }),
      })
    ).json() as { roomId: string };

    const byGuest = await app.request(`/api/rooms/${locked.roomId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'intruder', password: 'new123' }),
    });
    expect(byGuest.status).toBe(403);

    const change = await app.request(`/api/rooms/${locked.roomId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'mod-host', password: 'new456' }),
    });
    expect(change.status).toBe(200);

    // 旧密码失效
    const oldPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest3', password: 'old123' }),
    });
    expect(oldPw.status).toBe(403);
    const newPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest3', password: 'new456' }),
    });
    expect(newPw.status).toBe(200);

    // 清除密码
    const clear = await app.request(`/api/rooms/${locked.roomId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'mod-host', password: '' }),
    });
    expect(clear.status).toBe(200);
    expect(((await clear.json()) as { hasPassword: boolean }).hasPassword).toBe(false);
    const joinNoPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest4' }),
    });
    expect(joinNoPw.status).toBe(200);
  });

  it('普通房间密码哈希持久化到 DB 并可恢复', async () => {
    const app = makeApp();
    const created = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '持久密码房', maxPlayers: 4, playerId: 'db-host', password: 'dbpw1', roomType: 'normal' }),
    });
    const { roomId } = (await created.json()) as { roomId: string };
    const rows = await loadAllRoomsFromDb();
    const row = rows.find((r) => r.id === roomId);
    expect(row?.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });
});
