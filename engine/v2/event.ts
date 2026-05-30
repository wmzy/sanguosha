import type { ServerEvent, PlayerEvent, Json } from './types';

let eventCounter = 0;

export function genId(): string {
  return `evt_${Date.now().toString(36)}_${(eventCounter++).toString(36)}`;
}

export function makeServerEvent(type: string, payload: Json): ServerEvent {
  return { id: genId(), type, timestamp: Date.now(), payload };
}

export function makePlayerEvent(type: string, payload: Json): PlayerEvent {
  return { id: genId(), type, timestamp: Date.now(), payload };
}
