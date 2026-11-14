// server/sse.ts — SSE 事件流端点。
// GET /api/rooms/:id/stream?playerId=xxx
// 建立 SSE 连接，创建 SseSink 注册到 room.players，持续推送 ServerMessage。
// 断线时通过 stream.onAbort 清理（EventSource 浏览器端自动重连 + Last-Event-ID）。

import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { ServerMessage, EventSeq } from './protocol';
import { serialize } from './protocol';
import type { ConnectionSink } from './connection';
import { getRoom, removeSpectator, leaveRoom, type Room } from './room';
import type { GameSession } from './session';
import { broadcastMessage } from './room';
import { getChatHistory, buildRoomState, ensureSeatOnReconnect, getRecentLeaveGrace } from './room';
import { resolveSessionIdentity } from './auth/guard';
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
    }).catch((err) => log.err('SSE writeSSE failed', err));
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

/** SSE 会话角色适配器：玩家/旁观者共用会话骨架（runSseSession），
 *  差异（名单、补座、视图恢复、断线清理）以钩子表达。 */
interface SseRoleAdapter {
  /** 注册 sink 到本角色名单（玩家 players / 旁观 spectators，替换旧 sink）。 */
  registerSink(sink: SseSink): void;
  /** 名单中该玩家当前的 sink（onAbort 守卫：只在自己仍是当前 sink 时清理）。 */
  currentSink(): ConnectionSink | undefined;
  /** 注册后的角色特定恢复步骤（玩家：ensureSeatOnReconnect 补座并广播）。 */
  onRegistered?(): void;
  /** 连接建立日志。 */
  logConnected(): void;
  /** room_joined 消息（玩家分支按已有座次/调试补座附 seatIndex）。 */
  joinedMessage(): ServerMessage;
  /** 游戏进行中恢复游戏视图（玩家 reconnectPlayer / 旁观 sendSpectatorInitialView）。 */
  resumeGame(session: GameSession, sink: SseSink): void;
  /** 连接断开日志。 */
  logDisconnected(): void;
  /** 名单守卫通过后的断线清理（玩家：宽限保留座位或 leaveRoom；旁观：removeSpectator）。 */
  cleanupOnDisconnect(): void;
}

/** 旁观者角色：注册 spectators 名单，断线走 removeSpectator + spectator_left 广播。 */
function spectatorRole(room: Room, playerId: string, lastSeq: number): SseRoleAdapter {
  return {
    // 注册 sink 到 spectators（替换 REST 入口时的 null sink）
    registerSink: (sink) => {
      room.spectators.set(playerId, sink);
    },
    currentSink: () => room.spectators.get(playerId),
    logConnected: () => log.info('SSE 旁观者连接建立', { roomId: room.id, playerId }),
    joinedMessage: () => ({ type: 'room_joined', roomId: room.id, playerId }),
    resumeGame: (session) => session.sendSpectatorInitialView(playerId, lastSeq),
    logDisconnected: () => log.info('SSE 旁观者连接断开', { roomId: room.id, playerId }),
    cleanupOnDisconnect: () => {
      removeSpectator(room.id, playerId, 'disconnect');
      playerRoomMap.delete(playerId);
      // 广播 spectator_left
      const r = getRoom(room.id);
      if (r) {
        broadcastMessage(r, { type: 'spectator_left', spectatorId: playerId });
      }
    },
  };
}

/** 玩家角色：注册 players 名单，断线按房间状态走重连宽限（handleDisconnect）
 *  或释放座位（leaveRoom）。 */
function playerRole(
  room: Room,
  playerId: string,
  session: GameSession | undefined,
  lastSeq: number,
): SseRoleAdapter {
  return {
    registerSink: (sink) => {
      room.players.set(playerId, sink);
    },
    currentSink: () => room.players.get(playerId),
    onRegistered: () => {
      // 修复 players/seats 一致性:服务器重启后 DB 不恢复 seats,客户端重连只走 SSE 时
      // players.set 却不分配座次,导致 "players 满 / seats 空" 的幽灵连接锁死房间。
      // 补座后广播,让房间内其他人(如旁观的房主)立即看到座位变化。
      if (ensureSeatOnReconnect(room, playerId)) {
        broadcastMessage(room, buildRoomState(room), playerId);
      }
    },
    logConnected: () => log.info('SSE 连接建立', { roomId: room.id, playerId, lastSeq }),
    joinedMessage: () => {
      let seatIndex: number | undefined;
      if (session) {
        const existingSeat = session.getPlayerName(playerId);
        if (existingSeat !== undefined) {
          seatIndex = existingSeat;
        } else if (room.isDebug) {
          seatIndex = session.assignDebugSeat(playerId);
        }
      }
      return {
        type: 'room_joined',
        roomId: room.id,
        playerId,
        ...(seatIndex !== undefined ? { seatIndex } : {}),
      };
    },
    resumeGame: (session, sink) => session.reconnectPlayer(playerId, sink, lastSeq),
    logDisconnected: () => log.info('SSE 连接断开', { roomId: room.id, playerId }),
    cleanupOnDisconnect: () => {
      room.players.delete(playerId);

      // session 在游戏开始后才创建(POST /start)，必须在断线时重新查询，
      // 而非使用 SSE 连接建立时捕获的引用(大厅阶段为 undefined)。
      const currentSession = gameSessions.get(room.id);
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
      // 'disconnect' 使 leaveRoom 把 playerId 记入近期离开宽限表——本连接的
      // EventSource 自动重连(不重走 POST /join)在窗口内仍被上方门禁放行,
      // 由 ensureSeatOnReconnect 补座;否则断线超过心跳窗口(约 10s,网络抖动/
      // 休眠唤醒)的玩家重连即 403 且 EventSource 永久失败,只能手动重进。
      const left = leaveRoom(room.id, playerId, 'disconnect');
      playerRoomMap.delete(playerId);
      if (left) {
        broadcastMessage(left, buildRoomState(left));
      }
    },
  };
}

/** 玩家/旁观者共用的 SSE 会话骨架：
 *  注册 sink → 恢复身份（玩家补座）→ room_joined → 游戏视图（进行中）→
 *  room_state → chat_history → 心跳 → 挂起至断开；onAbort 名单守卫后走角色清理。 */
async function runSseSession(
  stream: SSEStreamingApi,
  room: Room,
  playerId: string,
  displayName: string | null,
  session: GameSession | undefined,
  lastSeq: number,
  role: SseRoleAdapter,
): Promise<void> {
  const roomId = room.id;
  const sink = new SseSink(stream);
  // epoch 校验通过才认可 seq,否则 0(强制快照)
  sink.setSeq(lastSeq);

  role.registerSink(sink);
  playerRoomMap.set(playerId, roomId);
  if (displayName) room.playerNames.set(playerId, displayName);
  // 身份已恢复，撤销断线宽限条目(下次断线由 onAbort 重新记录)
  room.recentlyLeft.delete(playerId);

  role.onRegistered?.();
  role.logConnected();
  sink.send(role.joinedMessage());

  if (session && room.status === '进行中') {
    role.resumeGame(session, sink);
  }

  // 发送 room_state（含旁观者列表和授权）：reconnectPlayer / 初始视图只发游戏视图
  // （initialView 快照或差量 event），不含 config/chat 等房间元数据。页面刷新/HMR
  // 重连时客户端 roomState 为 null，若不补发 room_state，ChatPanel 等依赖
  // roomState.config 的组件将不渲染。
  sink.send(buildRoomState(room));

  // 发送聊天历史（如果有）
  const chatHist = getChatHistory(roomId);
  if (chatHist.length > 0) {
    sink.send({ type: 'chat_history', messages: chatHist });
  }

  const stopHeartbeat = startHeartbeat(stream);

  stream.onAbort(() => {
    role.logDisconnected();
    stopHeartbeat();
    sink.close();
    // 只在自己仍是当前 sink 时删除（刷新重连后旧连接的 onAbort 可能晚于新连接触发）。
    // 缺少此守卫时,刷新重连会丢失旁观身份:新 joinAsSpectator 覆盖了 spectators[sid],
    // 但旧 onAbort 仍触发 removeSpectator 删掉新注册,导致 switchRole(spectator→player)
    // 找不到该玩家而失败("加入游戏失败")。
    if (role.currentSink() !== sink) return;
    role.cleanupOnDisconnect();
  });

  await new Promise<void>((resolve) => {
    stream.onAbort(() => resolve());
  });
}

/**
 * 注册 SSE stream 路由到 Hono app。
 * 在 routes/room-routes.ts 中通过 app.get('/api/rooms/:id/stream', sseStreamHandler) 注册。
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
    const identity = await resolveSessionIdentity(c);
    if ('reason' in identity) {
      return c.json(
        {
          error: identity.reason === 'invalid_token' ? '登录已过期，请重新登录' : '请先登录',
          code: 'AUTH_REQUIRED',
        },
        401,
      );
    }
    playerId = identity.user.id;
    displayName = identity.user.displayName;
  } else {
    playerId = queryPlayerId ?? generatePlayerId();
  }

  // 非 debug 房:仅房间成员(座位上/成员名单/旁观名单)可建流。正常流程先 POST /join
  // (密码+容量+状态校验后分配座位)或 /join-spectator 再连 SSE;缺此校验时,
  // 任何登录用户凭 roomId 直连即可绕过进房密码与容量限制入房,且玩家分支的
  // ensureSeatOnReconnect 会把非成员补进空座(重启恢复路径的副作用被滥用为越权入口)。
  // 例外——近期断线成员宽限:等待中/已结束阶段 SSE 断线(超过心跳检测窗口)会立即
  // 走 leaveRoom/removeSpectator 清空三名单,而浏览器 EventSource 约 3s 自动重连
  // 只打本端点、不重走 POST /join,若无宽限会被 403 拒绝且 EventSource 对非 2xx
  // 永久失败,用户只剩手动「返回大厅」重进。断线路径已把 playerId 记入
  // room.recentlyLeft,窗口内(RECENT_LEAVE_GRACE_MS)视作成员,重连后由下方
  // ensureSeatOnReconnect/旁观分支恢复原身份——与正常重连路径一致。进行中状态
  // 不查宽限表(断线座位宽限期已覆盖,防越权语义不变);主动退出/被踢不记录,
  // 从未入房者更无条目,仍 403。服务器重启路径由 DB 持久化的 playerNames 覆盖。
  const graceEntry = room.isDebug ? null : getRecentLeaveGrace(room, playerId);
  if (
    !room.isDebug &&
    !room.seats.includes(playerId) &&
    !room.playerNames.has(playerId) &&
    !room.spectators.has(playerId) &&
    !(graceEntry && room.status !== '进行中')
  ) {
    return c.json({ error: '你不在本房间中', code: 'NOT_MEMBER' }, 403);
  }

  return streamSSE(c, async (stream) => {
    try {
      const session = gameSessions.get(roomId);
      // epoch 校验通过才认可 seq,否则 0(强制快照)
      const lastSeq = parseLastEventId(lastEventId, session?.eventEpoch);

      // 判断连接身份：先查 spectators（旁观者），再查 players（玩家）。
      // 宽限窗口内的断线旁观者已被 removeSpectator 清出 spectators，按宽限条目记录的
      // 角色走旁观分支恢复身份，而非误入玩家分支被 ensureSeatOnReconnect 补成玩家。
      const isSpectator =
        room.spectators.has(playerId) ||
        (graceEntry?.role === 'spectator' && room.status !== '进行中');

      // 玩家/旁观者共用会话骨架,角色差异经 adapter 钩子传入
      const role = isSpectator
        ? spectatorRole(room, playerId, lastSeq)
        : playerRole(room, playerId, session, lastSeq);
      await runSseSession(stream, room, playerId, displayName, session, lastSeq, role);
    } catch (err) {
      log.err('SSE handler error', err);
    }
  });
}
