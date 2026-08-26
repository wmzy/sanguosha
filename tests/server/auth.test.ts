// tests/server/auth.test.ts — 用户认证模块测试(注册/登录/会话/GitHub upsert)
// 与房间密码端点测试(建房带密码/加房验证/旁观验证/改密)。
// 2026-08-17 二次扩展:游客模式移除——房间身份强制登录(playerId=userId)、
// playerNames 显示名投影、改名传播、profile/password 端点、SSE sgs_token。
// 来源:用户登录认证 + 房间密码 + 移除游客模式需求;后续相关回归用例归并到此文件。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { applyAuthRoutes } from '../../src/server/auth/routes';
import { applyRestRoutes } from '../../src/server/rest';
import {
  initRoomStore,
  closeRoomStore,
  loadAllRoomsFromDb,
} from '../../src/server/roomStore';
import { getRoom, buildRoomState, applyDisplayName } from '../../src/server/room';
import { hashPassword, verifyPassword } from '../../src/server/auth/password';
import {
  upsertGithubUser,
  getUserByToken,
  createSession,
  createUser,
  verifyLogin,
  deleteSession,
  updateDisplayName,
  changePassword,
} from '../../src/server/auth/store';
import { GameSession } from '../../src/server/session';
import { gameSessions } from '../../src/server/registry';
import { setRoomStatus } from '../../src/server/room';
import { _resetForTests as resetLifecycles } from '../../src/server/lifecycles';

function makeApp(): Hono {
  const app = new Hono();
  applyAuthRoutes(app);
  applyRestRoutes(app);
  return app;
}

/** 注册一个用户并返回 { cookie, token, userId } — 房间操作的登录上下文。 */
async function registerUser(
  app: Hono,
  username: string,
): Promise<{ cookie: string; token: string; userId: string; displayName: string }> {
  const reg = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pass123' }),
  });
  expect(reg.status).toBe(200);
  const setCookie = reg.headers.get('set-cookie')!;
  const cookie = setCookie.split(';')[0];
  const body = (await reg.json()) as { token: string; user: { id: string; displayName: string } };
  return { cookie, token: body.token, userId: body.user.id, displayName: body.user.displayName };
}

beforeAll(async () => {
  // 内存数据库(不传 dataDir = :memory:),隔离且随进程丢弃
  await initRoomStore(':memory:');
});

afterAll(async () => {
  await closeRoomStore();
  resetLifecycles();
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

  it('改名:合法更新,非法昵称拒绝', async () => {
    const u = await createUser('rename_user', 'pass123');
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    const ok = await updateDisplayName(u.user.id, '新昵称');
    expect(ok?.displayName).toBe('新昵称');
    expect(await updateDisplayName(u.user.id, '')).toBeNull();
    expect(await updateDisplayName(u.user.id, '带 空格')).toBeNull();
    expect(await updateDisplayName(u.user.id, 'x'.repeat(25))).toBeNull();
  });

  it('改密:旧密码校验,新密码生效', async () => {
    const u = await createUser('pwchange_user', 'old1234');
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    const bad = await changePassword(u.user.id, 'wrong000', 'new1234');
    expect(bad.ok === false && bad.error === '旧密码错误').toBe(true);
    const ok = await changePassword(u.user.id, 'old1234', 'new1234');
    expect(ok.ok).toBe(true);
    const relogin = await verifyLogin('pwchange_user', 'new1234');
    expect(relogin.ok).toBe(true);
  });
});

// ── HTTP 路由 ──

describe('auth/routes', () => {
  it('注册返回 Set-Cookie + token,且 /me 恢复登录态', async () => {
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
    // 程序化通道:token 也在响应体(HGC/MCP 走 Bearer)
    const body = (await reg.json()) as { token: string };
    expect(body.token).toMatch(/^[0-9a-f]+$/);

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

  it('PATCH /profile 改名,Bearer token 可用', async () => {
    const app = makeApp();
    const { token } = await registerUser(app, 'profile_user');
    const res = await app.request('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: '个人页改名' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { displayName: string } }).user.displayName).toBe('个人页改名');
  });

  it('PUT /password 改密:旧密码错误 400', async () => {
    const app = makeApp();
    const { cookie } = await registerUser(app, 'pwroute_user');
    const res = await app.request('/api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ oldPassword: 'nope123', newPassword: 'new12345' }),
    });
    expect(res.status).toBe(400);
  });
});

// ── 房间身份强制(游客模式移除) ──

describe('房间登录强制', () => {
  it('未登录建房/加入/旁观全部 401', async () => {
    const app = makeApp();
    const created = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '锁', maxPlayers: 2 }),
    });
    expect(created.status).toBe(401);
    expect(((await created.json()) as { code?: string }).code).toBe('AUTH_REQUIRED');

    // 假装带 playerId 的游客加入也被拒
    const join = await app.request('/api/rooms/XXXXXX/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest' }),
    });
    expect(join.status).toBe(401);

    const spectate = await app.request('/api/rooms/XXXXXX/join-spectator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'guest' }),
    });
    expect(spectate.status).toBe(401);
  });

  it('建房 playerId = userId,显示名投影 playerNames', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'roomhost1');
    const created = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ name: '身份房', maxPlayers: 4 }),
    });
    expect(created.status).toBe(200);
    const { roomId, playerId, playerName } = (await created.json()) as {
      roomId: string;
      playerId: string;
      playerName: string;
    };
    expect(playerId).toBe(host.userId);
    expect(playerName).toBe(host.displayName);

    // room_state 与列表投影 playerNames
    const state = buildRoomState(getRoom(roomId)!) as {
      playerNames?: Record<string, string>;
    };
    expect(state.playerNames?.[host.userId]).toBe(host.displayName);
    const list = (await (
      await app.request('/api/rooms?type=multiplayer')
    ).json()) as Array<{ id: string; playerNames?: Record<string, string> }>;
    const item = list.find((r) => r.id === roomId);
    expect(item?.playerNames?.[host.userId]).toBe(host.displayName);
  });

  it('伪造 body.playerId 无效:加入者身份恒为会话用户', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'roomhost2');
    const guest = await registerUser(app, 'roomguest2');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '防伪造', maxPlayers: 4 }),
      })
    ).json()) as { roomId: string };

    // 声称自己是别人,服务端忽略
    const joined = await app.request(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ playerId: 'someone-else' }),
    });
    expect(joined.status).toBe(200);
    const body = (await joined.json()) as { playerId: string };
    expect(body.playerId).toBe(guest.userId);
    const room = getRoom(roomId)!;
    expect(room.seats.includes(guest.userId)).toBe(true);
    expect(room.seats.includes('someone-else')).toBe(false);
    expect(room.playerNames.get(guest.userId)).toBe(guest.displayName);
  });

  it('Bearer token 与 Cookie 等价(程序化通道)', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'bearerhost');
    const created = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
      body: JSON.stringify({ name: 'Bearer 房', maxPlayers: 2 }),
    });
    expect(created.status).toBe(200);
    const { playerId } = (await created.json()) as { playerId: string };
    expect(playerId).toBe(host.userId);
  });

  it('改名传播到已加入房间(room_state 广播由调用方断言,此处断言数据面)', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'renamehost');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '改名房', maxPlayers: 2 }),
      })
    ).json()) as { roomId: string };

    // 经 REST 改名(会触发 applyDisplayName)
    const renamed = await app.request('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ displayName: '改名后主机' }),
    });
    expect(renamed.status).toBe(200);

    const room = getRoom(roomId)!;
    expect(room.playerNames.get(host.userId)).toBe('改名后主机');
    // applyDisplayName 直接调用等价(数据面)
    applyDisplayName(host.userId, '再次改名');
    expect(getRoom(roomId)!.playerNames.get(host.userId)).toBe('再次改名');
  });

  // ── 2026-08-26 回归:REST 操作路由身份伪造族修复 ──
  // ready/cancel-ready/switch-role/seat/seat-swap/view-*/config/DELETE 房间
  // 此前信任 body.playerId,可伪造他人身份;非调试房一律以会话 userId 为准。

  it('ready/cancel-ready:未登录 401;登录非成员伪造 playerId 无效;房主正常准备', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_ready_host');
    const outsider = await registerUser(app, 'auth_ready_out');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '准备鉴权房', maxPlayers: 2 }),
      })
    ).json()) as { roomId: string };
    const room = getRoom(roomId)!;

    // 未登录(无 cookie)→ 401
    const anon = await app.request(`/api/rooms/${roomId}/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: host.userId }),
    });
    expect(anon.status).toBe(401);

    // 登录的非成员冒充房主准备 → 服务端以会话身份校验,outside 不在 seats → 拒绝,
    // host 的准备状态不受伪造影响
    const forged = await app.request(`/api/rooms/${roomId}/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: outsider.cookie },
      body: JSON.stringify({ playerId: host.userId }),
    });
    expect(forged.status).toBe(400);
    expect(room.readyPlayers.has(host.userId)).toBe(false);

    // 垃圾 id 无法经 cancel-ready/ready 污染 readyPlayers(allReady DoS 回归)
    const junk = await app.request(`/api/rooms/${roomId}/cancel-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'junk-id' }),
    });
    expect(junk.status).toBe(401);

    // 房主本人正常准备成功
    const ok = await app.request(`/api/rooms/${roomId}/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ playerId: 'ignored' }),
    });
    expect(ok.status).toBe(200);
    expect(getRoom(roomId)!.readyPlayers.has(host.userId)).toBe(true);
  });

  it('switch-role:未登录 401;冒充他人转旁观无效', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_role_host');
    const guest = await registerUser(app, 'auth_role_guest');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '换身份鉴权房', maxPlayers: 4 }),
      })
    ).json()) as { roomId: string };

    const forged = await app.request(`/api/rooms/${roomId}/switch-role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ playerId: host.userId, role: 'spectator' }),
    });
    // 服务端忽略伪造的 playerId,以 guest 会话执行(guest 不在房间 → 失败)
    expect(forged.status).toBe(400);
    const room = getRoom(roomId)!;
    expect(room.spectators.has(host.userId)).toBe(false);
    expect(room.seats[0]).toBe(host.userId);

    // 未登录 → 401
    const anon = await app.request(`/api/rooms/${roomId}/switch-role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: host.userId, role: 'spectator' }),
    });
    expect(anon.status).toBe(401);
  });

  it('seat-swap request/respond 与 seat:未登录 401,身份不采信 body', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_seat_host');
    const guest = await registerUser(app, 'auth_seat_guest');
    const created = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ name: '座位鉴权房', maxPlayers: 3 }),
    });
    const { roomId } = (await created.json()) as { roomId: string };
    // guest 加入占座 1
    await app.request(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({}),
    });
    // host 经 SSE 外通道占座:直接 joinRoom 数据面(host 已在 seats[0],players 补连接)
    // 这里走 REST join 幂等重入即可补 players
    await app.request(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({}),
    });
    const room = getRoom(roomId)!;

    // 未登录发起换座 → 401
    const anonReq = await app.request(`/api/rooms/${roomId}/seat-swap/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: host.userId, targetSeat: 2 }),
    });
    expect(anonReq.status).toBe(401);

    // guest 冒充 host 向 seat 2 发起交换 → 以 guest 会话执行(guest 在座 1,
    // 目标座 2 为空 → requestSeatSwap 拒绝),host 名下无请求
    const forged = await app.request(`/api/rooms/${roomId}/seat-swap/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ playerId: host.userId, targetSeat: 2 }),
    });
    expect(forged.status).toBe(400);
    expect(room.pendingSeatSwaps.size).toBe(0);

    // 移动座位:未登录 → 401
    const anonSeat = await app.request(`/api/rooms/${roomId}/seat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: guest.userId, targetSeat: 2 }),
    });
    expect(anonSeat.status).toBe(401);

    // guest 本人移座(带 cookie,body.playerId 被忽略也无所谓)→ 成功
    const moved = await app.request(`/api/rooms/${roomId}/seat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ targetSeat: 2 }),
    });
    expect(moved.status).toBe(200);
    expect(getRoom(roomId)!.seats[2]).toBe(guest.userId);
  });

  it('view 审批链:非本房玩家 approve-view 403;旁观者申请以会话身份为准', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_view_host');
    const outsider = await registerUser(app, 'auth_view_out');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '审批鉴权房', maxPlayers: 2 }),
      })
    ).json()) as { roomId: string };

    // 未登录玩家调 approve-view → 401(requireUser 无凭据短路)
    const anon = await app.request(`/api/rooms/${roomId}/approve-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spectatorId: 'spec-x', targetSeat: 0 }),
    });
    expect(anon.status).toBe(401);

    // 登录但不在本房 → 403(防任何人批准旁观者查看任意座次泄露私有视图)
    const forbidden = await app.request(`/api/rooms/${roomId}/approve-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: outsider.cookie },
      body: JSON.stringify({ spectatorId: 'spec-x', targetSeat: 0 }),
    });
    expect(forbidden.status).toBe(403);
    expect(getRoom(roomId)!.viewGrants.has('spec-x')).toBe(false);

    // 正向路径:outsider 转旁观并发起申请,房主(join 后为本房玩家)审批成功
    await app.request(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({}),
    });
    await app.request(`/api/rooms/${roomId}/join-spectator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: outsider.cookie },
      body: JSON.stringify({}),
    });
    // 旁观者申请查看座次 0(spectatorId 以会话身份为准)
    const req = await app.request(`/api/rooms/${roomId}/request-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: outsider.cookie },
      body: JSON.stringify({ spectatorId: 'someone-else', targetSeat: 0 }),
    });
    expect(req.status).toBe(200);
    expect(getRoom(roomId)!.pendingViewRequests.has(outsider.userId)).toBe(true);

    // 非玩家的旁观者不能自己批准自己(403)
    const selfApprove = await app.request(`/api/rooms/${roomId}/approve-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: outsider.cookie },
      body: JSON.stringify({ spectatorId: outsider.userId, targetSeat: 0 }),
    });
    expect(selfApprove.status).toBe(403);

    // 本房玩家(host)批准 → 授权生效
    const approve = await app.request(`/api/rooms/${roomId}/approve-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ spectatorId: outsider.userId, targetSeat: 0 }),
    });
    expect(approve.status).toBe(200);
    expect(getRoom(roomId)!.viewGrants.get(outsider.userId)).toBe(0);
  });

  it('config:冒充房主改配置无效;房主本人可改', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_cfg_host');
    const guest = await registerUser(app, 'auth_cfg_guest');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '配置鉴权房', maxPlayers: 4 }),
      })
    ).json()) as { roomId: string };

    // guest 冒充 host 身份改配置 → updateConfig 内部按会话解析出的 hostId 校验拒绝
    const forged = await app.request(`/api/rooms/${roomId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({
        playerId: host.userId,
        config: { ...getRoom(roomId)!.config, name: '被篡改' },
      }),
    });
    expect(forged.status).toBe(400);
    expect(getRoom(roomId)!.name).not.toBe('被篡改');

    // 房主本人改名成功
    const ok = await app.request(`/api/rooms/${roomId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({
        config: { ...getRoom(roomId)!.config, name: '房主改的名' },
      }),
    });
    expect(ok.status).toBe(200);
    expect(getRoom(roomId)!.name).toBe('房主改的名');
  });

  it('DELETE /api/rooms/:id:未登录 401、非房主 403、房主删除成功', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_del_host');
    const other = await registerUser(app, 'auth_del_other');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '删房鉴权房', maxPlayers: 2 }),
      })
    ).json()) as { roomId: string };

    // 未登录 → 401
    const anon = await app.request(`/api/rooms/${roomId}`, { method: 'DELETE' });
    expect(anon.status).toBe(401);
    expect(getRoom(roomId)).not.toBeNull();

    // 已登录非房主 → 403
    const forbidden = await app.request(`/api/rooms/${roomId}`, {
      method: 'DELETE',
      headers: { Cookie: other.cookie },
    });
    expect(forbidden.status).toBe(403);
    expect(getRoom(roomId)).not.toBeNull();

    // 房主 → 删除成功
    const ok = await app.request(`/api/rooms/${roomId}`, {
      method: 'DELETE',
      headers: { Cookie: host.cookie },
    });
    expect(ok.status).toBe(200);
    expect(getRoom(roomId)).toBeNull();
  });

  // ── 2026-08-26 二批回归:start/restart/action/reorder/log 鉴权漏网 ──

  it('start:未登录 401;非房主伪造 body.playerId=hostId 403;房主通过鉴权进入 allReady 检查', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_start_host');
    const intruder = await registerUser(app, 'auth_start_in');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '开局鉴权房', maxPlayers: 2 }),
      })
    ).json()) as { roomId: string };

    // 未登录(即使声称 playerId = host.userId)→ 401
    const anon = await app.request(`/api/rooms/${roomId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: host.userId }),
    });
    expect(anon.status).toBe(401);

    // 已登录的入侵者冒充房主(body.playerId = host.userId)→ 403。
    // 修复前此处直接通过 hostId 校验(400 还有玩家未准备/或开始游戏)。
    const forged = await app.request(`/api/rooms/${roomId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: intruder.cookie },
      body: JSON.stringify({ playerId: host.userId }),
    });
    expect(forged.status).toBe(403);
    expect(((await forged.json()) as { error: string }).error).toBe('只有房主可以开始游戏');

    // 房主本人 → 通过身份校验,到达 allReady 检查(单人房间 players<2 → 400 未全员准备)
    const ok = await app.request(`/api/rooms/${roomId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ playerId: host.userId }),
    });
    expect(ok.status).toBe(400);
    expect(((await ok.json()) as { error: string }).error).toBe('还有玩家未准备');
  });

  it('restart:未登录 401、非房主 403;房主可把进行中状态重置回等待中', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_restart_host');
    const intruder = await registerUser(app, 'auth_restart_in');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '重置鉴权房', maxPlayers: 2 }),
      })
    ).json()) as { roomId: string };

    // 构造存在 session 的房间(占位 session,无 state)
    gameSessions.set(roomId, new GameSession(getRoom(roomId)!, false));
    setRoomStatus(roomId, '进行中');

    // 未登录 → 401
    const anon = await app.request(`/api/rooms/${roomId}/restart`, { method: 'POST' });
    expect(anon.status).toBe(401);
    expect(getRoom(roomId)!.status).toBe('进行中');

    // 非房主(伪造 playerId 也无效)→ 403
    const forbidden = await app.request(`/api/rooms/${roomId}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: intruder.cookie },
      body: JSON.stringify({ playerId: host.userId }),
    });
    expect(forbidden.status).toBe(403);
    expect(getRoom(roomId)!.status).toBe('进行中');

    // 房主 → 重置成功,状态回「等待中」
    const ok = await app.request(`/api/rooms/${roomId}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({}),
    });
    expect(ok.status).toBe(200);
    expect(getRoom(roomId)!.status).toBe('等待中');
    gameSessions.delete(roomId);
  });

  it('action/reorder:未登录 401(修复前匿名可提交 accepted);登录成员正常受理', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_action_host');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '操作鉴权房', maxPlayers: 2 }),
      })
    ).json()) as { roomId: string };
    gameSessions.set(roomId, new GameSession(getRoom(roomId)!, false));

    // 未登录携带他人 playerId 提交 action → 401(修复前返回 accepted:true)
    const anonAction = await app.request(`/api/rooms/${roomId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: host.userId, action: { ownerId: 0 } }),
    });
    expect(anonAction.status).toBe(401);

    // 未登录 reorder 同样 401
    const anonReorder = await app.request(`/api/rooms/${roomId}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: host.userId, order: [] }),
    });
    expect(anonReorder.status).toBe(401);

    // 房主本人(cookie)→ 受理(state 为 null 时 handleAction 内部静默忽略,路由仍 accepted)
    const ok = await app.request(`/api/rooms/${roomId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ playerId: 'forged-but-ignored', action: { ownerId: 0 } }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { accepted: boolean }).accepted).toBe(true);
    gameSessions.delete(roomId);
  });

  it('log:未登录 401、非成员 403、本房玩家可访问(到达业务层)', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'auth_log_host');
    const outsider = await registerUser(app, 'auth_log_out');
    const { roomId } = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '日志鉴权房', maxPlayers: 2 }),
      })
    ).json()) as { roomId: string };
    gameSessions.set(roomId, new GameSession(getRoom(roomId)!, false));

    // 未登录 → 401(修复前任何人可拉完整动作日志)
    const anon = await app.request(`/api/rooms/${roomId}/log`);
    expect(anon.status).toBe(401);

    // 登录但不在本房 → 403
    const forbidden = await app.request(`/api/rooms/${roomId}/log`, {
      headers: { Cookie: outsider.cookie },
    });
    expect(forbidden.status).toBe(403);

    // 本房玩家(host 建房即在 players)→ 通过鉴权,业务层因无 state 返回 404 无日志
    const ok = await app.request(`/api/rooms/${roomId}/log`, {
      headers: { Cookie: host.cookie },
    });
    expect(ok.status).toBe(404);
    expect(((await ok.json()) as { error: string }).error).toBe('无游戏日志');
    gameSessions.delete(roomId);
  });
});

// ── 房间密码端点 ──

describe('房间密码', () => {
  it('建房带密码 → 列表投影 hasPassword,哈希不出现在响应', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'pw_host');
    const created = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ name: '密码房', maxPlayers: 4, password: '1234' }),
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
    const host = await registerUser(app, 'free_host');
    const guest = await registerUser(app, 'pw_guest');

    // 无密码房
    const free = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '自由房', maxPlayers: 4 }),
      })
    ).json()) as { roomId: string };
    const joinFree = await app.request(`/api/rooms/${free.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({}),
    });
    expect(joinFree.status).toBe(200);

    // 有密码房
    const locked = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '锁房', maxPlayers: 4, password: '九个密码9' }),
      })
    ).json()) as { roomId: string };

    const noPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({}),
    });
    expect(noPw.status).toBe(403);
    expect(((await noPw.json()) as { code?: string }).code).toBe('ROOM_PASSWORD_REQUIRED');

    const wrongPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(wrongPw.status).toBe(403);

    const okPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ password: '九个密码9' }),
    });
    expect(okPw.status).toBe(200);

    // 成员重连免密
    const rejoin = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({}),
    });
    expect(rejoin.status).toBe(200);
  });

  it('旁观同样需要密码,已入房旁观者免密', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'sp_host');
    const spec = await registerUser(app, 'sp_guest');
    const locked = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '旁观锁房', maxPlayers: 4, password: 'sp1234' }),
      })
    ).json()) as { roomId: string };

    const noPw = await app.request(`/api/rooms/${locked.roomId}/join-spectator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: spec.cookie },
      body: JSON.stringify({}),
    });
    expect(noPw.status).toBe(403);

    const okPw = await app.request(`/api/rooms/${locked.roomId}/join-spectator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: spec.cookie },
      body: JSON.stringify({ password: 'sp1234' }),
    });
    expect(okPw.status).toBe(200);

    // 已在 spectators 中(重连)免密
    const rejoin = await app.request(`/api/rooms/${locked.roomId}/join-spectator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: spec.cookie },
      body: JSON.stringify({}),
    });
    expect(rejoin.status).toBe(200);
  });

  it('房主可改密/清除密码,非房主 403(伪造 playerId 无效)', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'mod_host');
    const intruder = await registerUser(app, 'mod_intruder');
    const locked = (await (
      await app.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
        body: JSON.stringify({ name: '改密房', maxPlayers: 4, password: 'old123' }),
      })
    ).json()) as { roomId: string };

    // 他人声称是房主(伪造 body.playerId = host.userId)仍被拒
    const byGuest = await app.request(`/api/rooms/${locked.roomId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: intruder.cookie },
      body: JSON.stringify({ playerId: host.userId, password: 'new123' }),
    });
    expect(byGuest.status).toBe(403);

    const change = await app.request(`/api/rooms/${locked.roomId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ password: 'new456' }),
    });
    expect(change.status).toBe(200);

    // 旧密码失效
    const oldPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: intruder.cookie },
      body: JSON.stringify({ password: 'old123' }),
    });
    expect(oldPw.status).toBe(403);
    const newPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: intruder.cookie },
      body: JSON.stringify({ password: 'new456' }),
    });
    expect(newPw.status).toBe(200);

    // 清除密码
    const clear = await app.request(`/api/rooms/${locked.roomId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ password: '' }),
    });
    expect(clear.status).toBe(200);
    expect(((await clear.json()) as { hasPassword: boolean }).hasPassword).toBe(false);
    const guest4 = await registerUser(app, 'mod_guest4');
    const joinNoPw = await app.request(`/api/rooms/${locked.roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest4.cookie },
      body: JSON.stringify({}),
    });
    expect(joinNoPw.status).toBe(200);
  });

  it('普通房间密码与显示名持久化到 DB 并可恢复', async () => {
    const app = makeApp();
    const host = await registerUser(app, 'db_host');
    const created = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({
        name: '持久密码房',
        maxPlayers: 4,
        password: 'dbpw1',
        roomType: 'normal',
      }),
    });
    const { roomId } = (await created.json()) as { roomId: string };
    const rows = await loadAllRoomsFromDb();
    const row = rows.find((r) => r.id === roomId);
    expect(row?.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(row?.playerNames?.[host.userId]).toBe(host.displayName);
  });
});
