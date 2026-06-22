// src/engine/event-stream.ts
// 事件流缓冲(ENGINE-DESIGN §4.6 / §8.2)。
//
// 单缓冲:引擎按发生顺序 push 事件;session 层做 per-player 视图分叉并广播。
// 真实 per-player 流推送在 server 层(`session.broadcastNewState` 等)实现。
import type { GameEvent } from './types';

const events: GameEvent[] = [];

export function pushEvent(event: GameEvent): void {
  events.push(event);
}

/** 获取全部缓冲事件(按 push 顺序)。供 session 广播后 clearEvents。 */
export function getEvents(fromIndex = 0): GameEvent[] {
  return events.slice(fromIndex);
}

/** 获取 seq > fromSeq 的所有事件。用于断线重连推差量。 */
export function getEventsSince(fromSeq: number): GameEvent[] {
  return events.filter(e => e.seq > fromSeq);
}

export function getEventCount(): number {
  return events.length;
}

export function clearEvents(): void {
  events.length = 0;
}
