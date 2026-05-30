import type { ServerEvent, PlayerEvent, Json } from './types';

let eventCounter = 0;

export function resetEventCounter(start: number = 0): void {
  eventCounter = start;
}

export function makeServerEvent(type: string, payload: Json): ServerEvent {
  return { id: `evt-${++eventCounter}`, type, timestamp: Date.now(), payload };
}

export function makePlayerEvent(type: string, payload: Json): PlayerEvent {
  return { id: `evt-${++eventCounter}`, type, timestamp: Date.now(), payload };
}
