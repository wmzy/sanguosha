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

export function getEvents(fromIndex = 0): GameEvent[] {
  return events.slice(fromIndex);
}

export function getEventCount(): number {
  return events.length;
}

export function clearEvents(): void {
  events.length = 0;
}
