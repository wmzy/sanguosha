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
import { createRoom, getRoom, deleteRoom, joinRoom, joinAsSpectator, leaveRoom, removeSpectator, RECENT_LEAVE_GRACE_MS } from '../../src/server/room';
import type { ConnectionSink } from '../../src/server/connection';

function createCaptureSink(captured: unknown[]): ConnectionSink {
  return {
    send: (msg) => captured.push(msg),
    close: () => {},
    isAlive: true,
  };
}

/** 读取 SSE 流首个数据块后释放：确保 streamSSE 回调已执行到首个 sink.send 之后
 *  (玩家分支的 players.set + ensureSeatOnReconnect 均在其之前)，房间状态断言才确定。 */
async function readFirstChunk(res: Response): Promise<void> {
  const reader = res.body!.getReader();
  try {
    await reader.read();
  } finally {
    reader.releaseLock();
  }
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

  // ── 断线重连宽限(近期离开表)回归,2026-08-27 ──
  // 场景:等待中/已结束阶段玩家断线超过心跳窗口(约 10s,网络抖动/休眠唤醒)→
  // SSE onAbort 走 leaveRoom 清空三名单(seats/playerNames/spectators)→ 浏览器
  // EventSource 约 3s 自动重连(不重走 POST /join)→ 被门禁 403 NOT_MEMBER 拒绝,
  // 且 EventSource 对非 2xx 永久失败,用户只剩手动「返回大厅」重进。
  // 修复:断线路径 leaveRoom/removeSpectator 以 'disconnect' 记入 room.recentlyLeft,
  // 门禁在等待中/已结束状态下命中宽限条目时放行,重连后由 ensureSeatOnReconnect/
  // 旁观分支恢复原身份。主动退出/被踢/从未入房均无条目,仍 403。

  it('等待中成员断线(触发 leaveRoom)后宽限窗口内重连:200 且座位恢复(修复前 403)', async () => {
    const guest = await register(app, `gg-${Date.now()}`);
    const room = createRoom('宽限', 3, 'h0', createCaptureSink([]));
    try {
      // guest 走正常 join 入房(占 1 号座位)
      joinRoom(room.id, guest.userId, createCaptureSink([]), 'gg');
      const url = `http://localhost/api/rooms/${room.id}/stream`;

      // 成员建立 SSE 流
      const first = await app.fetch(new Request(url, { headers: { Cookie: guest.cookie } }));
      expect(first.status).toBe(200);
      await readFirstChunk(first);
      await first.body?.cancel();

      // 模拟 sse.ts 玩家分支 onAbort(等待中阶段):删 players 后 leaveRoom('disconnect')
      const r = getRoom(room.id)!;
      r.players.delete(guest.userId);
      leaveRoom(room.id, guest.userId, 'disconnect');
      playerRoomMap.delete(guest.userId);
      // 三名单均已清出——修复前此时重连即 403
      expect(r.seats.includes(guest.userId)).toBe(false);
      expect(r.playerNames.has(guest.userId)).toBe(false);
      expect(r.spectators.has(guest.userId)).toBe(false);
      expect(r.recentlyLeft.has(guest.userId)).toBe(true); // 断线时已记入宽限表

      // EventSource 自动重连(不重走 POST /join)→ 宽限放行 + ensureSeatOnReconnect 补座
      const again = await app.fetch(new Request(url, { headers: { Cookie: guest.cookie } }));
      expect(again.status).toBe(200);
      expect(again.headers.get('content-type')).toContain('text/event-stream');
      await readFirstChunk(again);
      const after = getRoom(room.id)!;
      expect(after.seats.includes(guest.userId)).toBe(true);
      expect(after.playerNames.has(guest.userId)).toBe(true); // 会话 displayName 恢复
      expect(after.recentlyLeft.has(guest.userId)).toBe(false); // 身份恢复即撤销宽限
      await again.body?.cancel();
    } finally {
      deleteRoom(room.id);
    }
  });

  it('从未入房者凭 roomId 直连仍 403(他人宽限条目不外溢,既有防护不回退)', async () => {
    const stranger = await register(app, `is-${Date.now()}`);
    const room = createRoom('越权', 3, 'h0', createCaptureSink([]));
    try {
      // keeper 入房并保持连接,保证 host 断线后快速房不被自动销毁
      joinRoom(room.id, 'keeper', createCaptureSink([]));

      // host 断线记入宽限表——房间里存在他人的宽限条目
      const left = leaveRoom(room.id, 'h0', 'disconnect');
      expect(left).not.toBeNull();
      expect(left!.recentlyLeft.has('h0')).toBe(true);

      // stranger 从未入房:仍 403 且不被补座
      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.id}/stream`, {
          headers: { Cookie: stranger.cookie },
        }),
      );
      expect(res.status).toBe(403);
      await res.body?.cancel();
      const after = getRoom(room.id)!;
      expect(after.players.has(stranger.userId)).toBe(false);
      expect(after.seats.includes(stranger.userId)).toBe(false);
    } finally {
      deleteRoom(room.id);
    }
  });

  it('宽限窗口过期后重连仍 403,且过期条目被门禁查询懒清理', async () => {
    const host = await register(app, `xh-${Date.now()}`);
    const room = createRoom('过期', 3, host.userId, createCaptureSink([]));
    try {
      // keeper 保房(host 断线后快速房不自动销毁)
      joinRoom(room.id, 'keeper', createCaptureSink([]));

      // host 断线记入宽限表,再把时间戳拨到窗口之外(等价于 60s 后才重连)
      leaveRoom(room.id, host.userId, 'disconnect');
      const r = getRoom(room.id)!;
      r.recentlyLeft.set(host.userId, { at: Date.now() - RECENT_LEAVE_GRACE_MS - 1, role: 'player' });

      const res = await app.fetch(
        new Request(`http://localhost/api/rooms/${room.id}/stream`, {
          headers: { Cookie: host.cookie },
        }),
      );
      expect(res.status).toBe(403);
      await res.body?.cancel();
      // 过期条目已被门禁查询顺手清理,表不随断线次数无限增长
      expect(r.recentlyLeft.size).toBe(0);
    } finally {
      deleteRoom(room.id);
    }
  });

  it('旁观者断线后宽限窗口内重连:200 且恢复旁观身份(而非被补成玩家)', async () => {
    const spec = await register(app, `sp-${Date.now()}`);
    const room = createRoom('旁观宽限', 2, 'h0', createCaptureSink([]));
    try {
      joinAsSpectator(room.id, spec.userId, createCaptureSink([]), 'sp');
      const url = `http://localhost/api/rooms/${room.id}/stream`;

      const first = await app.fetch(new Request(url, { headers: { Cookie: spec.cookie } }));
      expect(first.status).toBe(200);
      await readFirstChunk(first);
      await first.body?.cancel();

      // 模拟 sse.ts 旁观分支 onAbort:removeSpectator('disconnect')
      removeSpectator(room.id, spec.userId, 'disconnect');
      playerRoomMap.delete(spec.userId);
      const r = getRoom(room.id)!;
      expect(r.spectators.has(spec.userId)).toBe(false);
      expect(r.recentlyLeft.get(spec.userId)?.role).toBe('spectator'); // 记录离开时角色

      // 重连 → 宽限按记录角色走旁观分支恢复身份
      const again = await app.fetch(new Request(url, { headers: { Cookie: spec.cookie } }));
      expect(again.status).toBe(200);
      await readFirstChunk(again);
      const after = getRoom(room.id)!;
      expect(after.spectators.has(spec.userId)).toBe(true); // 旁观身份恢复
      expect(after.seats.includes(spec.userId)).toBe(false); // 未被误补成玩家
      expect(after.recentlyLeft.has(spec.userId)).toBe(false);
      await again.body?.cancel();
    } finally {
      deleteRoom(room.id);
    }
  });
});
