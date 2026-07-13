// server/sse.ts — SSE 事件流端点。
// GET /api/rooms/:id/stream?playerId=xxx
// 建立 SSE 连接，创建 SseSink 注册到 room.players，持续推送 ServerMessage。
// 断线时通过 stream.onAbort 清理（EventSource 浏览器端自动重连 + Last-Event-ID）。

import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { ServerMessage, EventSeq } from './protocol';
import { serialize } from './protocol';
import type { ConnectionSink } from './connection';
import { getRoom, removeSpectator } from './room';
import { broadcastMessage } from './room';
import { getChatHistory, buildRoomState } from './room';
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

    // 判断连接身份：先查 spectators（旁观者），再查 players（玩家）
    const isSpectator = room.spectators.has(playerId);

    if (isSpectator) {
      // 旁观者：注册 sink 到 spectators（替换 REST 入口时的 null sink）
      room.spectators.set(playerId, sink);
      playerRoomMap.set(playerId, roomId);

      log.info('SSE 旁观者连接建立', { roomId, playerId });

      const session = gameSessions.get(roomId);

      sink.send({ type: 'room_joined', roomId, playerId });

      if (session && room.status === '进行中') {
        session.sendSpectatorInitialView(playerId);
      }

      // 发送 room_state（含旁观者列表和授权）
      sink.send(buildRoomState(room));

      // 发送聊天历史（如果有）
      const chatHist = getChatHistory(roomId);
      if (chatHist.length > 0) {
        sink.send({ type: 'chat_history', messages: chatHist });
      }

      stream.onAbort(() => {
        log.info('SSE 旁观者连接断开', { roomId, playerId });
        sink.close();
        removeSpectator(roomId, playerId);
        playerRoomMap.delete(playerId);
        // 广播 spectator_left
        const r = getRoom(roomId);
        if (r) {
          broadcastMessage(r, { type: 'spectator_left', spectatorId: playerId });
        }
      });

      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    } else {
      // 玩家连接（现有逻辑）
      room.players.set(playerId, sink);
      playerRoomMap.set(playerId, roomId);

      log.info('SSE 连接建立', { roomId, playerId, lastSeq });

      const session = gameSessions.get(roomId);

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
        session.reconnectPlayer(playerId, sink, lastSeq);
      } else {
        sink.send(buildRoomState(room));
      }

      // 发送聊天历史（如果有）
      const chatHist = getChatHistory(roomId);
      if (chatHist.length > 0) {
        sink.send({ type: 'chat_history', messages: chatHist });
      }

      stream.onAbort(() => {
        log.info('SSE 连接断开', { roomId, playerId });
        sink.close();
        // 只在自己仍是当前 sink 时删除（刷新重连后旧连接的 onAbort 可能晚于新连接触发）
        if (room.players.get(playerId) === sink) {
          room.players.delete(playerId);
          if (session) {
            session.handleDisconnect(playerId);
          }
          if (room.isDebug) {
            playerRoomMap.delete(playerId);
          }
        }
      });

      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error('SSE handler error', { error: e.stack ?? String(e) });
    }
  });
}
