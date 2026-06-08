import type { Atom, AtomLogEntry, Json } from './types';

let eventCounter = 0;

export function resetEventCounter(start: number = 0): void {
  eventCounter = start;
}

export function getEventCounter(): number {
  return eventCounter;
}

export function makeLogEntry(atom: Atom): AtomLogEntry {
  return { id: `evt-${++eventCounter}`, timestamp: Date.now(), atom };
}

export function restoreEventCounterFromLog(serverLog: AtomLogEntry[]): void {
  let maxId = 0;
  for (const entry of serverLog) {
    const match = entry.id.match(/^evt-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxId) maxId = num;
    }
  }
  eventCounter = maxId;
}
