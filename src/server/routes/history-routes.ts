// server/routes/history-routes.ts — 对局历史/录像路由(自 rest.ts 拆出)。
// 路由路径/方法/校验顺序/响应形状与拆分前完全一致。
// (房主身份解析见 auth/guard.ts 的 resolvePlayerIdFromBodyOrQuery。)

import type { Hono } from 'hono';
import { getRoom } from '../room';
import { resolvePlayerIdFromBodyOrQuery } from '../auth/guard';
import {
  listGameHistory,
  getGameReplay,
  filterReplayForViewer,
  deleteGameHistoryEntry,
  clearGameHistory,
} from '../gameHistory';
import { requireHost, requireRoomMember } from './helpers';

/** 注册对局历史/录像路由。 */
export function applyHistoryRoutes(app: Hono): void {
  // GET /api/rooms/:id/history — 对局结果列表(最新在前,不含录像数据)
  // 对局结果含各成员 userId、身份局身份与胜负:非调试房间仅本房成员可读
  // (权限模型与 log/chat 一致;此前完全无鉴权,未登录者凭 roomId 可枚举全部条目)。
  app.get('/api/rooms/:id/history', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    const member = await requireRoomMember(c, room, '仅房间成员可查看历史');
    if (member.error) return member.error;
    const entries = await listGameHistory(roomId);
    return c.json({ entries });
  });

  // GET /api/rooms/:id/history/:entryId — 单局录像(前端重放拉取;?download=1 触发浏览器下载)
  // 重放拉取带 playerId 做视角限制:参赛者只拿到自己座次的 delta,其他人只拿旁观座次;
  // download=1 是显式导出动作,返回完整多座次文件。
  app.get('/api/rooms/:id/history/:entryId', async (c) => {
    const roomId = c.req.param('id');
    const entryId = c.req.param('entryId');
    const replay = await getGameReplay(roomId, entryId);
    if (!replay) return c.json({ error: '录像不存在' }, 404);
    const entry = (await listGameHistory(roomId)).find((e) => e.id === entryId) ?? null;
    // 身份解析:活跃的非调试房间必须携带有效会话,playerId 一律取会话 userId——
    // 信任 query.playerId 会允许伪造他人身份拉取其座次的私有手牌 delta。
    // 调试房与已回收房间(历史回看)保持游客模型(query.playerId),后者无法做
    // 会话↔房间映射,沿用既有查询参数行为。
    let viewerId: string | null = c.req.query('playerId') ?? null;
    const liveRoom = getRoom(roomId);
    // 成员资格:录像含全部座次的私有事件流,仅参赛者/本房旁观者可读
    // (此前任何登录用户可拉任意对局录像)。
    const member = await requireRoomMember(c, liveRoom, '仅房间成员可查看录像');
    if (member.error) return member.error;
    if (member.user) viewerId = member.user.id;
    // download 导出必须在身份校验之后:此前该分支位于登录校验之前,
    // 未登录者凭 roomId+entryId 即可下载完整多座次文件(含每人私有手牌 delta),
    // 而 entryId 可经无鉴权的列表接口枚举,构成完整越权读取链。
    if (c.req.query('download') === '1') {
      const room = getRoom(roomId);
      const name = `sanguosha-replay-${room?.name ?? roomId}-${entryId}.json`;
      return c.body(JSON.stringify(replay), 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
      });
    }
    const seat =
      viewerId && entry
        ? (entry.players.find((p) => p.playerId === viewerId)?.seat ?? null)
        : null;
    return c.json(filterReplayForViewer(replay, seat));
  });

  // DELETE /api/rooms/:id/history/:entryId — 房主删除单条历史(含录像文件)
  app.delete('/api/rooms/:id/history/:entryId', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    const playerId = await resolvePlayerIdFromBodyOrQuery(c, room);
    const forbidden = requireHost(c, room, playerId, '只有房主可以删除历史');
    if (forbidden) return forbidden;

    const ok = await deleteGameHistoryEntry(roomId, c.req.param('entryId'));
    if (!ok) return c.json({ error: '历史条目不存在' }, 404);
    return c.json({ success: true });
  });

  // DELETE /api/rooms/:id/history — 房主清空全部历史
  app.delete('/api/rooms/:id/history', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    const playerId = await resolvePlayerIdFromBodyOrQuery(c, room);
    const forbidden = requireHost(c, room, playerId, '只有房主可以清空历史');
    if (forbidden) return forbidden;

    await clearGameHistory(roomId);
    return c.json({ success: true });
  });
}
