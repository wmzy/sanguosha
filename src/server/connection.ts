// server/connection.ts — 传输层抽象。
// ConnectionSink 解耦 Room/Session 与底层传输（当前仅 SSE）。

import type { ServerMessage } from './protocol';

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
