import type { ServerEvent, PlayerEvent, Json } from './types';

let eventCounter = 0;

export function resetEventCounter(start: number = 0): void {
  eventCounter = start;
}

export function getEventCounter(): number {
  return eventCounter;
}

export function makeServerEvent(type: string, payload: Json): ServerEvent {
  return { id: `evt-${++eventCounter}`, type, timestamp: Date.now(), payload };
}

export function makePlayerEvent(type: string, payload: Json): PlayerEvent {
  return { id: `evt-${++eventCounter}`, type, timestamp: Date.now(), payload };
}

export function restoreEventCounterFromLog(serverLog: ServerEvent[]): void {
  let maxId = 0;
  for (const evt of serverLog) {
    const match = evt.id.match(/^evt-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxId) maxId = num;
    }
  }
  eventCounter = maxId;
}
