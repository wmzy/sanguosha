// server/routes/seat-routes.ts — 座位管理路由(自 rest.ts 拆出)。
// 路由路径/方法/校验顺序/响应形状与拆分前完全一致。

import type { Hono } from 'hono';
import { moveSeat, requestSeatSwap, respondSeatSwap, broadcastMessage } from '../room';
import {
  broadcastRoomState,
  optString,
  readJsonBody,
  resolvePlayerOrRespond,
} from './helpers';

/** 注册座位管理路由。 */
export function applySeatRoutes(app: Hono): void {
  // POST /api/rooms/:id/seat — 移动到空座位
  app.post('/api/rooms/:id/seat', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const targetSeat = typeof raw.targetSeat === 'number' ? raw.targetSeat : -1;
    if (targetSeat < 0) return c.json({ error: '缺少 targetSeat' }, 400);
    // 非调试房间:身份取会话 userId,防伪造他人移座
    const resolved = await resolvePlayerOrRespond(c, roomId, optString(raw.playerId));
    if (resolved.response) return resolved.response;
    const playerId = resolved.playerId;

    const room = moveSeat(roomId, playerId, targetSeat);
    if (!room) return c.json({ error: '无法移动到此座位' }, 400);

    broadcastRoomState(room);
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/seat-swap/request — 请求座位交换
  app.post('/api/rooms/:id/seat-swap/request', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const targetSeat = typeof raw.targetSeat === 'number' ? raw.targetSeat : -1;
    if (targetSeat < 0) return c.json({ error: '缺少 targetSeat' }, 400);
    // 非调试房间:发起者身份取会话 userId,防以他人名义发起换座请求
    const resolved = await resolvePlayerOrRespond(c, roomId, optString(raw.playerId));
    if (resolved.response) return resolved.response;
    const requesterId = resolved.playerId;

    const result = requestSeatSwap(roomId, requesterId, targetSeat);
    if (!result) return c.json({ error: '无法发起交换请求' }, 400);

    broadcastMessage(result.room, {
      type: 'seat_swap_request',
      requesterId,
      requesterSeat: result.requesterSeat,
      targetSeat,
      targetPlayerId: result.targetPlayerId,
      expiresAt: result.expiresAt,
    });
    broadcastRoomState(result.room);
    return c.json({ success: true, expiresAt: result.expiresAt });
  });

  // POST /api/rooms/:id/seat-swap/respond — 响应座位交换
  app.post('/api/rooms/:id/seat-swap/respond', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const requesterId = optString(raw.requesterId);
    if (!requesterId) return c.json({ error: '缺少 requesterId' }, 400);
    // 非调试房间:响应者身份取会话 userId,防代他人接受/拒绝换座
    const resolved = await resolvePlayerOrRespond(c, roomId, optString(raw.playerId));
    if (resolved.response) return resolved.response;
    const responderId = resolved.playerId;
    const accept = raw.accept === true;

    const result = respondSeatSwap(roomId, responderId, requesterId, accept);
    if (!result) return c.json({ error: '交换请求无效或已过期' }, 400);

    broadcastMessage(result.room, {
      type: 'seat_swap_result',
      success: result.swapped,
      requesterId,
      responderId,
    });
    broadcastRoomState(result.room);
    return c.json({ success: true, swapped: result.swapped });
  });
}
