// server/connection.ts — 传输层抽象。
// ConnectionSink 解耦 Room/Session 与底层传输（当前仅 SSE）。

import type { ServerMessage } from './protocol';
import type { Room } from './room';
import { createLogger } from './logger';

const log = createLogger('connection');

/**
 * 连接 sink：服务端向客户端发送消息的抽象接口。
 * Room.players 和 Session 均依赖此接口，不直接依赖传输层细节。
 */
export interface ConnectionSink {
  /** 发送一条 ServerMessage。 */
  send(message: ServerMessage): void;
  /** 关闭连接。 */
  close(): void;
  /** 连接是否活跃。 */
  readonly isAlive: boolean;
}

/** 安全发送：吞掉 sink.send 抛出的异常（断连/半开连接写失败），记日志（describe
 *  携带连接上下文，如 playerId）后继续，保证单个连接故障不影响其余成员的收播。 */
export function sendSafe(sink: ConnectionSink, message: ServerMessage, describe: string): void {
  try {
    sink.send(message);
  } catch (err) {
    log.err(describe, err);
  }
}

/** 向房间全部连接广播（先玩家后旁观者），excludeId 指定的连接跳过。
 *  describe 生成发送失败时的日志描述（保留调用方原有的 playerId 上下文）。 */
export function broadcastToRoom(
  room: Room,
  message: ServerMessage,
  describe: (id: string, role: 'player' | 'spectator') => string,
  excludeId?: string,
): void {
  for (const [id, sink] of room.players) {
    if (id === excludeId) continue;
    sendSafe(sink, message, describe(id, 'player'));
  }
  // 旁观者也接收广播
  for (const [id, sink] of room.spectators) {
    if (id === excludeId) continue;
    sendSafe(sink, message, describe(id, 'spectator'));
  }
}
