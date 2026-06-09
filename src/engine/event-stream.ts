// src/engine/event-stream.ts
import type { GameEvent, GameState, GameView } from './types';
import { buildView } from './view/buildView';

const perPlayerEvents = new Map<string, GameEvent[]>();

export function pushEvent(viewer: string, event: GameEvent): void {
  if (!perPlayerEvents.has(viewer)) perPlayerEvents.set(viewer, []);
  perPlayerEvents.get(viewer)!.push(event);
}

export function getEvents(viewer: string, fromIndex = 0): GameEvent[] {
  return (perPlayerEvents.get(viewer) ?? []).slice(fromIndex);
}

export function clearEvents(): void {
  perPlayerEvents.clear();
}