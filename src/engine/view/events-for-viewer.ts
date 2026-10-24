// Per-viewer event projection, including private, separately sequenced pending metadata.
import type { GameState, GameEventEnvelope } from '../types';

export function eventsForViewer(state: GameState, viewer: number, sinceSeq = 0): GameEventEnvelope[] {
  const out: GameEventEnvelope[] = [];
  for (const entry of state.atomHistory) {
    if (entry.seq <= sinceSeq) continue;
    const envelope: GameEventEnvelope = { seq: entry.seq, timestamp: entry.timestamp };
    if (entry.kind === 'atom') {
      const owner = entry.viewEvents.ownerViews.get(viewer);
      const event = owner === null ? null : owner ?? entry.viewEvents.othersView;
      if (event) envelope.view = event;
    } else {
      const data = entry.views ? entry.views.get(String(viewer)) ?? null : entry.data;
      if (data !== null) envelope.notify = { skillId: entry.skillId, eventType: entry.eventType, data };
    }
    const pendingKey = String(viewer);
    if (entry.pendingViews && Object.prototype.hasOwnProperty.call(entry.pendingViews, pendingKey)) {
      envelope.pending = entry.pendingViews[pendingKey];
    }
    // Hidden atom/notify does not hide a separately visible pending delta, and never exposes another viewer's snapshot.
    if (envelope.view || envelope.notify || envelope.pending !== undefined) out.push(envelope);
  }
  return out;
}
