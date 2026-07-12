// server/sse.ts — SSE 事件流端点。
// GET /api/rooms/:id/stream?playerId=xxx
// 建立 SSE 连接，创建 SseSink 注册到 room.players，持续推送 ServerMessage。
// 断线时通过 stream.onAbort 清理（EventSource 浏览器端自动重连 + Last-Event-ID）。

import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { ServerMessage, EventSeq } from './protocol';
import { serialize } from './protocol';
import type { ConnectionSink } from './connection';
import { getRoom } from './room';
import { gameSessions, playerRoomMap } from './registry';
import { generatePlayerId } from './utils';
import { createLogger } from './logger';

const log = createLogger('sse');

/**
 * SSE sink：通过 Hono SSEStreamingApi 推送 ServerMessage。
 * 有 seq 的消息设置 SSE id（供 Last-Event-ID 重连）。
 */
export class SseSink implements ConnectionSink {
  private closed = false;
  private seq = 0;

  constructor(private stream: SSEStreamingApi) {}

  send(message: ServerMessage): void {
    if (this.closed) return;
    const data = serialize(message);
    // 有 seq 的消息设置 SSE id，供 Last-Event-ID 断线重连
    const id = 'seq' in message ? String((message as { seq: EventSeq }).seq) : undefined;
    void this.stream.writeSSE({
      data,
      ...(id ? { id } : {}),
    }).catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error('SSE writeSSE failed', { error: e.stack ?? String(e) });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.stream.close().catch(() => {});
  }

  get isAlive(): boolean {
    return !this.closed && !this.stream.aborted;
  }

  /** 更新已发送的 seq 水位（供断线重连计算补发起点） */
  setSeq(seq: number): void {
    this.seq = seq;
  }

  get lastSeq(): number {
    return this.seq;
  }
}

/**
 * 注册 SSE stream 路由到 Hono app。
 * 在 rest.ts 中通过 app.get('/api/rooms/:id/stream', sseStreamHandler) 注册。
 */
export async function sseStreamHandler(c: Context): Promise<Response> {
  const roomId = c.req.param('id')!;
  const queryPlayerId = c.req.query('playerId');
  const lastEventId = c.req.header('Last-Event-ID');

  const room = getRoom(roomId);
  if (!room) {
    return c.json({ error: '房间不存在' }, 404);
  }

  const playerId: string = queryPlayerId ?? generatePlayerId();
  const lastSeq = lastEventId ? parseInt(lastEventId, 10) || 0 : 0;

  return streamSSE(c, async (stream) => {
    try {
    const sink = new SseSink(stream);
    sink.setSeq(lastSeq);

    // 注册 sink 到 room.players（替换 REST 入口时的 null sink）
    room.players.set(playerId, sink);
    playerRoomMap.set(playerId, roomId);

    log.info('SSE 连接建立', { roomId, playerId, lastSeq });

    const session = gameSessions.get(roomId);

    // 发送 room_joined 消息（携带座次）
    let seatIndex: number | undefined;
    if (session) {
      const existingSeat = session.getPlayerName(playerId);
      if (existingSeat !== undefined) {
        seatIndex = existingSeat;
      } else if (room.isDebug) {
        seatIndex = session.assignDebugSeat(playerId);
      }
    }
    sink.send({
      type: 'room_joined',
      roomId,
      playerId,
      ...(seatIndex !== undefined ? { seatIndex } : {}),
    });

    if (session && room.status === '进行中') {
      // 游戏已开始（重连场景）：恢复视图
      session.reconnectPlayer(playerId, sink, lastSeq);
    } else {
      // 配置阶段：发送 room_state
      sink.send({
        type: 'room_state',
        readyPlayers: [...room.readyPlayers],
        playerIds: [...room.players.keys()],
        hostId: room.hostId,
        maxPlayers: room.maxPlayers,
        config: room.config,
      });
    }

    // 等待连接关闭（客户端断开或服务端关闭）
    // streamSSE 的 callback 必须保持运行直到流结束
    stream.onAbort(() => {
      log.info('SSE 连接断开', { roomId, playerId });
      sink.close();
      room.players.delete(playerId);
      // 触发断线处理（grace period 等）
      if (session) {
        session.handleDisconnect(playerId);
      }
      // debug 模式:playerId 一次性使用,清理映射防泄漏
      if (room.isDebug) {
        playerRoomMap.delete(playerId);
      }
    });

    // 保持流打开：等待 abort
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error('SSE handler error', { error: e.stack ?? String(e) });
    }
  });
}
