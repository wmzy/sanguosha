// server/sse.ts — SSE 事件流端点。
// GET /api/rooms/:id/stream?playerId=xxx
// 建立 SSE 连接，创建 SseSink 注册到 room.players，持续推送 ServerMessage。
// 断线时通过 stream.onAbort 清理（EventSource 浏览器端自动重连 + Last-Event-ID）。

import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { ServerMessage, EventSeq } from './protocol';
import { serialize } from './protocol';
import type { ConnectionSink } from './connection';
import { getRoom, removeSpectator, leaveRoom } from './room';
import { broadcastMessage } from './room';
import { getChatHistory, buildRoomState, ensureSeatOnReconnect } from './room';
import { getSessionUser, extractSessionToken } from './auth/guard';
import { gameSessions, playerRoomMap } from './registry';
import { generatePlayerId } from './utils';
import { createLogger } from './logger';

const log = createLogger('sse');

/** SSE 心跳间隔。定期发送 comment 行(`: ping\n\n`)保持连接活跃，
 *  使服务端能及时检测到客户端异常断开(断网/进程崩溃/系统休眠)。
 *  无心跳时，异常断开不发 TCP FIN，onAbort 不触发，grace timer 无法启动。
 *  心跳写入到达 Node.js outgoing 后，socket 断开会触发 writable error/close →
 *  reader.cancel() → stream.abort() → onAbort → handleDisconnect。 */
const SSE_HEARTBEAT_INTERVAL_MS = 10_000;

/** 为 SSE 连接创建心跳定时器。返回清除函数(在 onAbort 时调用)。 */
function startHeartbeat(stream: SSEStreamingApi): () => void {
  const timer = setInterval(() => {
    void stream.write(': ping\n\n');
  }, SSE_HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

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
    // 有 seq 的消息设置 SSE id，供 Last-Event-ID 断线重连。
    // event 消息带 epoch(局标识)时用 `<epoch>:<seq>` 格式,重连时据 epoch 校验
    // 是否跨局(不匹配回退快照);其余带 seq 消息维持纯数字。
    let id: string | undefined;
    if (message.type === 'event' && message.epoch != null) {
      id = `${message.epoch}:${message.seq}`;
    } else if ('seq' in message) {
      id = String((message as { seq: EventSeq }).seq);
    }
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

/** 解析 Last-Event-ID 为重连差量补发起点。
 *  仅当能解析为 `<epoch>:<seq>` 且 epoch 与当前局(session.eventEpoch)一致时,
 *  返回 seq;否则(跨局/跨进程 epoch 不匹配、旧格式纯数字、无 header)返回 0,
 *  强制走 initialView 全量快照,保证安全过渡。 */
export function parseLastEventId(raw: string | undefined, epoch: number | undefined): number {
  if (!raw || epoch === undefined) return 0;
  const m = /^(\d+):(\d+)$/.exec(raw);
  if (!m) return 0;
  return Number(m[1]) === epoch ? Number(m[2]) : 0;
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

  // 身份解析:非调试房间必须携带有效会话(Cookie/Bearer/?sgs_token),
  // playerId 一律取会话 userId;调试房间保持游客模型(queryPlayerId 或自动生成)。
  let playerId: string;
  let displayName: string | null = null;
  if (!room.isDebug) {
    if (!extractSessionToken(c)) {
      return c.json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401);
    }
    const user = await getSessionUser(c);
    if (!user) {
      return c.json({ error: '登录已过期，请重新登录', code: 'AUTH_REQUIRED' }, 401);
    }
    playerId = user.id;
    displayName = user.displayName;
  } else {
    playerId = queryPlayerId ?? generatePlayerId();
  }

  return streamSSE(c, async (stream) => {
    try {
    const sink = new SseSink(stream);
    const session = gameSessions.get(roomId);
    // epoch 校验通过才认可 seq,否则 0(强制快照)
    const lastSeq = parseLastEventId(lastEventId, session?.eventEpoch);
    sink.setSeq(lastSeq);

    // 判断连接身份：先查 spectators（旁观者），再查 players（玩家）
    const isSpectator = room.spectators.has(playerId);

    if (isSpectator) {
      // 旁观者：注册 sink 到 spectators（替换 REST 入口时的 null sink）
      room.spectators.set(playerId, sink);
      playerRoomMap.set(playerId, roomId);
      if (displayName) room.playerNames.set(playerId, displayName);

      log.info('SSE 旁观者连接建立', { roomId, playerId });

      sink.send({ type: 'room_joined', roomId, playerId });

      if (session && room.status === '进行中') {
        session.sendSpectatorInitialView(playerId, lastSeq);
      }

      // 发送 room_state（含旁观者列表和授权）
      sink.send(buildRoomState(room));

      // 发送聊天历史（如果有）
      const chatHist = getChatHistory(roomId);
      if (chatHist.length > 0) {
        sink.send({ type: 'chat_history', messages: chatHist });
      }

      const stopHeartbeat = startHeartbeat(stream);

      stream.onAbort(() => {
        log.info('SSE 旁观者连接断开', { roomId, playerId });
        stopHeartbeat();
        sink.close();
        // 只在自己仍是当前 sink 时删除（刷新重连后旧连接的 onAbort 可能晚于新连接触发）。
        // 缺少此守卫时,刷新重连会丢失旁观身份:新 joinAsSpectator 覆盖了 spectators[sid],
        // 但旧 onAbort 仍触发 removeSpectator 删掉新注册,导致 switchRole(spectator→player)
        // 找不到该玩家而失败("加入游戏失败")。
        if (room.spectators.get(playerId) !== sink) return;
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
      if (displayName) room.playerNames.set(playerId, displayName);

      // 修复 players/seats 一致性:服务器重启后 DB 不恢复 seats,客户端重连只走 SSE 时
      // players.set 却不分配座次,导致 "players 满 / seats 空" 的幽灵连接锁死房间。
      // 补座后广播,让房间内其他人(如旁观的房主)立即看到座位变化。
      if (ensureSeatOnReconnect(room, playerId)) {
        broadcastMessage(room, buildRoomState(room), playerId);
      }

      log.info('SSE 连接建立', { roomId, playerId, lastSeq });

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
      }
      // 始终发送 room_state：reconnectPlayer 只发游戏视图（initialView 快照或差量 event），
      // 不含 config/chat 等房间元数据。页面刷新/HMR 重连时客户端 roomState 为 null，
      // 若不补发 room_state，ChatPanel 等依赖 roomState.config 的组件将不渲染。
      sink.send(buildRoomState(room));

      // 发送聊天历史（如果有）
      const chatHist = getChatHistory(roomId);
      if (chatHist.length > 0) {
        sink.send({ type: 'chat_history', messages: chatHist });
      }

      const stopHeartbeat = startHeartbeat(stream);

      stream.onAbort(() => {
        log.info('SSE 连接断开', { roomId, playerId });
        stopHeartbeat();
        sink.close();
        // 只在自己仍是当前 sink 时删除（刷新重连后旧连接的 onAbort 可能晚于新连接触发）
        if (room.players.get(playerId) !== sink) return;
        room.players.delete(playerId);

        // session 在游戏开始后才创建(POST /start)，必须在断线时重新查询，
        // 而非使用 SSE 连接建立时捕获的引用(大厅阶段为 undefined)。
        const currentSession = gameSessions.get(roomId);
        if (currentSession && room.status === '进行中') {
          // 游戏进行中:保留座位进入重连宽限期(广播 player_disconnected)。
          // 座位必须保留,否则断线玩家在宽限期内重连将无法归位。
          currentSession.handleDisconnect(playerId);
          if (room.isDebug) {
            playerRoomMap.delete(playerId);
          }
          return;
        }

        // 等待/已结束阶段:释放座位并广播 room_state。
        // 否则断线玩家的座位永远保留在 seats 中,房间内持续显示其"在线"
        // (幽灵座位),且新玩家无法补位。普通房间保留房间本身(房主可重新进入);
        // 快速房间全员离开时由 leaveRoom 自动销毁(返回 null,无需广播)。
        const left = leaveRoom(roomId, playerId);
        playerRoomMap.delete(playerId);
        if (left) {
          broadcastMessage(left, buildRoomState(left));
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
